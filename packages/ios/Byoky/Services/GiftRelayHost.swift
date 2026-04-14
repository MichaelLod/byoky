import Foundation

/// Maintains persistent `role: "sender"` WebSocket connections to each active
/// gift's relay, so gifts created on iOS are actually reachable by recipients.
/// Mirrors the browser extension's `connectGiftRelay`
/// (`packages/extension/entrypoints/background.ts`). iOS suspends
/// `URLSessionWebSocketTask` when backgrounded, so `RootView` disconnects on
/// `.background` and reconnects on `.active` via `WalletStore` lifecycle hooks.
@MainActor
final class GiftRelayHost {
    static let shared = GiftRelayHost()

    private var connections: [String: GiftRelayConnection] = [:]
    private weak var wallet: WalletStore?

    private init() {}

    func attach(wallet: WalletStore) {
        self.wallet = wallet
    }

    func connect(gift: Gift) {
        guard let wallet else { return }
        if connections[gift.id] != nil { return }
        if !gift.active || Date() > gift.expiresAt { return }

        let conn = GiftRelayConnection(gift: gift, wallet: wallet, host: self)
        connections[gift.id] = conn
        conn.start()
    }

    func disconnect(giftId: String) {
        connections.removeValue(forKey: giftId)?.close(reconnectAfterDelay: false)
    }

    func disconnectAll() {
        let all = connections
        connections.removeAll()
        for (_, conn) in all {
            conn.close(reconnectAfterDelay: false)
        }
    }

    /// Open sockets for every active, non-expired gift. Called on unlock and
    /// on `.active` scene phase. Idempotent — gifts with an existing
    /// connection are skipped.
    func reconnectAll() {
        guard let wallet, wallet.status == .unlocked else { return }
        for gift in wallet.gifts where gift.active && Date() < gift.expiresAt {
            connect(gift: gift)
        }
    }

    fileprivate func forget(giftId: String) {
        connections.removeValue(forKey: giftId)
    }

    fileprivate func currentGift(id: String) -> Gift? {
        wallet?.gifts.first(where: { $0.id == id && $0.active && Date() < $0.expiresAt })
    }
}

@MainActor
private final class GiftRelayConnection {
    private let giftId: String
    private let relayUrl: String
    private let authToken: String
    private weak var wallet: WalletStore?
    private weak var host: GiftRelayHost?

    private var ws: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var reconnectTask: Task<Void, Never>?
    private var budgetLock: Task<Void, Never> = Task {}
    private var closed = false

    init(gift: Gift, wallet: WalletStore, host: GiftRelayHost) {
        self.giftId = gift.id
        self.relayUrl = gift.relayUrl
        self.authToken = gift.authToken
        self.wallet = wallet
        self.host = host
    }

    func start() {
        guard let url = URL(string: relayUrl), url.scheme == "wss" else { return }

        closed = false
        let task = URLSession.shared.webSocketTask(with: url)
        ws = task
        task.resume()

        let auth: [String: Any] = [
            "type": "relay:auth",
            "roomId": giftId,
            "authToken": authToken,
            "role": "sender",
            // Primary socket — takes over from the vault fallback's priority 0.
            "priority": 1,
        ]
        sendJSON(auth)

        // Relay enforces a 5-min idle timeout; ping every 2 min to keep alive.
        pingTimer = Timer.scheduledTimer(withTimeInterval: 120, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.sendJSON(["type": "relay:ping"])
            }
        }

        listen(ws: task)
    }

    func close(reconnectAfterDelay: Bool) {
        if closed { return }
        closed = true
        pingTimer?.invalidate()
        pingTimer = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        ws?.cancel(with: .normalClosure, reason: nil)
        ws = nil

        if reconnectAfterDelay {
            scheduleReconnect()
        }
    }

    private func scheduleReconnect() {
        reconnectTask = Task { [weak self, giftId] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let host = self?.host,
                      let gift = host.currentGift(id: giftId) else { return }
                host.connect(gift: gift)
            }
        }
    }

    private func listen(ws task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            switch result {
            case .success(.string(let text)):
                if let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = json["type"] as? String {
                    Task { @MainActor in
                        self?.handleMessage(type: type, json: json)
                    }
                }
                Task { @MainActor in
                    self?.continueListen(on: task)
                }

            case .success:
                Task { @MainActor in
                    self?.continueListen(on: task)
                }

            case .failure:
                Task { @MainActor in
                    guard let self, !self.closed else { return }
                    self.host?.forget(giftId: self.giftId)
                    self.close(reconnectAfterDelay: true)
                }
            }
        }
    }

    private func continueListen(on task: URLSessionWebSocketTask) {
        guard !closed, ws === task else { return }
        listen(ws: task)
    }

    private func handleMessage(type: String, json: [String: Any]) {
        switch type {
        case "relay:auth:result":
            if json["success"] as? Bool != true {
                // Auth failed (bad token / room taken) — don't reconnect.
                host?.forget(giftId: giftId)
                close(reconnectAfterDelay: false)
            }

        case "relay:request":
            serializedRequest(json)

        default:
            break
        }
    }

    /// Serialize requests per gift so budget check → API call → usage update
    /// are atomic. Matches the extension's per-gift Promise chain in
    /// `handleGiftProxyRequest`.
    private func serializedRequest(_ json: [String: Any]) {
        let prev = budgetLock
        budgetLock = Task { [weak self] in
            _ = await prev.value
            await self?.handleRelayRequest(json)
        }
    }

    private func handleRelayRequest(_ json: [String: Any]) async {
        guard let requestId = json["requestId"] as? String,
              let urlString = json["url"] as? String,
              let method = json["method"] as? String else { return }

        guard let wallet else {
            sendError(requestId: requestId, code: "WALLET_LOCKED", message: "Sender wallet is locked")
            return
        }

        guard let gift = wallet.gifts.first(where: { $0.id == self.giftId }) else {
            sendError(requestId: requestId, code: "GIFT_EXPIRED", message: "Gift no longer exists")
            return
        }
        if !gift.active || Date() > gift.expiresAt {
            sendError(requestId: requestId, code: "GIFT_EXPIRED", message: "Gift has expired or been revoked")
            return
        }
        if gift.usedTokens >= gift.maxTokens {
            sendError(requestId: requestId, code: "GIFT_BUDGET_EXHAUSTED", message: "Gift token budget exhausted")
            return
        }
        guard let credential = wallet.credentials.first(where: { $0.id == gift.credentialId }) else {
            sendError(requestId: requestId, code: "PROVIDER_UNAVAILABLE", message: "Credential no longer available")
            return
        }
        // Use the gift's provider for everything downstream — the request
        // message's providerId is the *source* in a cross-family translated
        // call and would mis-route URL validation, auth, usage parsing, etc.
        // Mirrors background.ts which uses `gift.providerId` throughout
        // handleGiftProxyRequest.
        let providerId = gift.providerId
        guard let upstreamUrl = Provider.validateUrl(urlString, for: providerId) else {
            sendError(requestId: requestId, code: "INVALID_URL", message: "Request URL does not match provider")
            return
        }

        let apiKey: String
        do {
            apiKey = try wallet.decryptKey(for: credential)
        } catch {
            sendError(requestId: requestId, code: "PROXY_ERROR", message: "Failed to decrypt credential")
            return
        }

        let headers = json["headers"] as? [String: String] ?? [:]
        let bodyString = json["body"] as? String

        var request = URLRequest(url: upstreamUrl)
        request.httpMethod = method
        request.timeoutInterval = 120

        if let finalBody = injectStreamUsageOptions(providerId: providerId, body: bodyString),
           let data = finalBody.data(using: .utf8) {
            request.httpBody = data
        }

        for (key, value) in headers {
            let lower = key.lowercased()
            if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
            request.setValue(value, forHTTPHeaderField: key)
        }

        Credential.applyAuth(
            to: &request,
            providerId: providerId,
            authMethod: credential.authMethod,
            apiKey: apiKey
        )

        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                sendError(requestId: requestId, code: "PROXY_ERROR", message: "Invalid upstream response")
                return
            }

            var responseHeaders: [String: String] = [:]
            for (key, value) in httpResponse.allHeaderFields {
                let lower = String(describing: key).lowercased()
                if sensitiveResponseHeaders.contains(lower) { continue }
                responseHeaders[lower] = String(describing: value)
            }

            sendJSON([
                "type": "relay:response:meta",
                "requestId": requestId,
                "status": httpResponse.statusCode,
                "statusText": HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
                "headers": responseHeaders,
            ])

            var buffer = Data()
            var fullResponseData = Data()
            for try await byte in bytes {
                buffer.append(byte)
                fullResponseData.append(byte)
                if buffer.count >= 4096 || byte == 0x0A {
                    if let chunk = String(data: buffer, encoding: .utf8) {
                        sendJSON([
                            "type": "relay:response:chunk",
                            "requestId": requestId,
                            "chunk": chunk,
                        ])
                    }
                    buffer.removeAll()
                }
            }
            if !buffer.isEmpty, let chunk = String(data: buffer, encoding: .utf8) {
                sendJSON([
                    "type": "relay:response:chunk",
                    "requestId": requestId,
                    "chunk": chunk,
                ])
            }

            sendJSON([
                "type": "relay:response:done",
                "requestId": requestId,
            ])

            if let responseBody = String(data: fullResponseData, encoding: .utf8),
               let usage = UsageParser.parseUsage(providerId: providerId, body: responseBody) {
                let total = usage.inputTokens + usage.outputTokens
                if total > 0,
                   let newUsed = wallet.addGiftSenderUsage(giftId: giftId, tokens: total) {
                    sendJSON([
                        "type": "relay:usage",
                        "giftId": giftId,
                        "usedTokens": newUsed,
                    ])
                }
            }

            wallet.logRequest(
                appOrigin: "gift",
                providerId: providerId,
                method: method,
                url: urlString,
                statusCode: httpResponse.statusCode,
                requestBody: bodyString?.data(using: .utf8),
                responseBody: String(data: fullResponseData, encoding: .utf8)
            )
        } catch {
            sendError(requestId: requestId, code: "PROXY_ERROR", message: "Request failed")
        }
    }

    private func sendError(requestId: String, code: String, message: String) {
        sendJSON([
            "type": "relay:response:error",
            "requestId": requestId,
            "error": ["code": code, "message": message],
        ])
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let str = String(data: data, encoding: .utf8) else { return }
        ws?.send(.string(str)) { _ in }
    }
}
