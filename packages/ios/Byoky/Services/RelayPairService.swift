import Foundation

enum PairStatus: Equatable {
    case idle
    case connecting
    case paired(appOrigin: String)
    case error(String)
}

struct PairPayload {
    let relayUrl: String
    let roomId: String
    let authToken: String
    let appOrigin: String

    static func decode(from encoded: String) -> PairPayload? {
        guard let data = base64UrlDecode(encoded),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["v"] as? Int == 1,
              let r = json["r"] as? String,
              let id = json["id"] as? String,
              let t = json["t"] as? String,
              let o = json["o"] as? String
        else { return nil }
        return PairPayload(relayUrl: r, roomId: id, authToken: t, appOrigin: o)
    }

    private static func base64UrlDecode(_ str: String) -> Data? {
        var base64 = str.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 { base64 += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: base64)
    }
}

@MainActor
final class RelayPairService: ObservableObject {
    @Published var status: PairStatus = .idle
    @Published var requestCount: Int = 0

    private var wsTask: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var wallet: WalletStore?
    private var pairedOrigin: String?
    private var lastPayload: PairPayload?

    func connect(payload: PairPayload, wallet: WalletStore) {
        self.wallet = wallet
        self.lastPayload = payload
        status = .connecting

        guard let url = URL(string: payload.relayUrl),
              url.scheme == "wss" else {
            status = .error("Relay must use a secure connection (wss://)")
            return
        }

        let ws = URLSession.shared.webSocketTask(with: url)
        wsTask = ws
        ws.resume()

        let auth: [String: Any] = [
            "type": "relay:auth",
            "roomId": payload.roomId,
            "authToken": payload.authToken,
            "role": "sender",
        ]

        guard let authData = try? JSONSerialization.data(withJSONObject: auth),
              let authString = String(data: authData, encoding: .utf8) else {
            status = .error("Failed to encode auth")
            return
        }

        ws.send(.string(authString)) { [weak self] error in
            if let error {
                Task { @MainActor in
                    self?.status = .error(error.localizedDescription)
                }
            }
        }

        listenForMessages(ws: ws, payload: payload)

        pingTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.sendPing()
        }
    }

    func disconnect() {
        pingTimer?.invalidate()
        pingTimer = nil
        wsTask?.cancel(with: .normalClosure, reason: nil)
        wsTask = nil
        pairedOrigin = nil
        lastPayload = nil
        status = .idle
        requestCount = 0
    }

    /// Reconnect after iOS app returns from background.
    func reconnectIfNeeded() {
        guard let payload = lastPayload, let wallet else { return }
        // Only reconnect if the WebSocket is gone but we had an active session
        guard case .paired = status, wsTask?.state != .running else {
            // Also reconnect if status shows error (connection lost)
            if case .error = status, lastPayload != nil {
                connect(payload: payload, wallet: wallet)
            }
            return
        }
        connect(payload: payload, wallet: wallet)
    }

    private func listenForMessages(ws: URLSessionWebSocketTask, payload: PairPayload) {
        ws.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                if case .string(let text) = message,
                   let data = text.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let type = json["type"] as? String {
                    Task { @MainActor in
                        self.handleMessage(type: type, json: json, payload: payload)
                    }
                }
                self.listenForMessages(ws: ws, payload: payload)

            case .failure:
                Task { @MainActor in
                    if case .paired = self.status {
                        self.status = .error("Connection lost")
                    }
                }
            }
        }
    }

    private func handleMessage(type: String, json: [String: Any], payload: PairPayload) {
        switch type {
        case "relay:auth:result":
            if json["success"] as? Bool == true {
                sendPairHello()
            } else {
                let error = json["error"] as? String ?? "Auth failed"
                status = .error(error)
            }

        case "relay:pair:ack":
            pairedOrigin = payload.appOrigin
            status = .paired(appOrigin: payload.appOrigin)

        case "relay:request":
            handleRelayRequest(json)

        case "relay:peer:status":
            if json["online"] as? Bool == false, case .paired = status {
                pairedOrigin = nil
                status = .idle
                requestCount = 0
            }

        default:
            break
        }
    }

    private func sendPairHello() {
        guard let wallet else { return }

        var providers: [String: [String: Any]] = [:]
        for credential in wallet.credentials {
            providers[credential.providerId] = [
                "available": true,
                "authMethod": credential.authMethod == .apiKey ? "api_key" : "oauth",
            ]
        }

        let msg: [String: Any] = [
            "type": "relay:pair:hello",
            "providers": providers,
        ]

        sendJSON(msg)
    }

    private func handleRelayRequest(_ json: [String: Any]) {
        guard case .paired = status else { return }

        guard let wallet,
              let requestId = json["requestId"] as? String,
              let providerId = json["providerId"] as? String,
              let urlString = json["url"] as? String,
              let method = json["method"] as? String else { return }

        guard let url = Provider.validateUrl(urlString, for: providerId) else {
            sendRelayError(requestId: requestId, code: "INVALID_URL", message: "URL doesn't match provider")
            return
        }

        let headers = json["headers"] as? [String: String] ?? [:]
        let bodyString = json["body"] as? String

        Task {
            await MainActor.run { requestCount += 1 }

            do {
                let credential = await MainActor.run {
                    wallet.credentials.first { $0.providerId == providerId }
                }
                guard let credential else {
                    sendRelayError(requestId: requestId, code: "NO_CREDENTIAL", message: "No credential for \(providerId)")
                    return
                }

                let apiKey = try await MainActor.run {
                    try wallet.decryptKey(for: credential)
                }

                var request = URLRequest(url: url)
                request.httpMethod = method
                request.timeoutInterval = 120

                if let bodyString {
                    request.httpBody = bodyString.data(using: .utf8)
                }

                for (key, value) in headers {
                    let lower = key.lowercased()
                    if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
                    request.setValue(value, forHTTPHeaderField: key)
                }

                Credential.applyAuth(to: &request, providerId: providerId, authMethod: credential.authMethod, apiKey: apiKey)

                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard let httpResponse = response as? HTTPURLResponse else {
                    sendRelayError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                    return
                }

                var responseHeaders: [String: String] = [:]
                for (key, value) in httpResponse.allHeaderFields {
                    responseHeaders[String(describing: key).lowercased()] = String(describing: value)
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

                let responseBody = String(data: fullResponseData, encoding: .utf8)
                let requestBody = bodyString?.data(using: .utf8)
                let origin = await MainActor.run { self.pairedOrigin ?? "relay" }
                await MainActor.run {
                    wallet.logRequest(
                        appOrigin: origin,
                        providerId: providerId,
                        method: method,
                        url: urlString,
                        statusCode: httpResponse.statusCode,
                        requestBody: requestBody,
                        responseBody: responseBody
                    )
                }

            } catch {
                sendRelayError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
            }
        }
    }

    private func sendRelayError(requestId: String, code: String, message: String) {
        sendJSON([
            "type": "relay:response:error",
            "requestId": requestId,
            "error": ["code": code, "message": message],
        ])
    }

    private func sendPing() {
        sendJSON(["type": "relay:ping", "ts": Int(Date().timeIntervalSince1970 * 1000)])
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let str = String(data: data, encoding: .utf8) else { return }
        wsTask?.send(.string(str)) { _ in }
    }
}
