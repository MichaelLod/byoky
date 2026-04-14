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
    private var pairAckTimer: Timer?
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
        pairAckTimer?.invalidate()
        pairAckTimer = nil
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
                // Start vault offer early — the async HTTP call needs time,
                // and we want it to arrive before the user closes the app.
                sendVaultOffer(appOrigin: payload.appOrigin)
                pairAckTimer?.invalidate()
                pairAckTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
                    Task { @MainActor in
                        guard let self, case .connecting = self.status else { return }
                        self.disconnect()
                        self.status = .error("Web app not responding — scan the QR code again")
                    }
                }
            } else {
                let error = json["error"] as? String ?? "Auth failed"
                status = .error(error)
            }

        case "relay:pair:ack":
            pairAckTimer?.invalidate()
            pairAckTimer = nil
            pairedOrigin = payload.appOrigin
            status = .paired(appOrigin: payload.appOrigin)
            // Durable Session record so the app shows up in the Apps screen
            // across reconnects. The user revokes explicitly when done.
            // Providers list reflects what the wallet can currently serve;
            // gifted credentials are advertised separately via sendPairHello.
            if let wallet {
                let providerIds = Array(Set(wallet.credentials.map { $0.providerId }))
                _ = try? wallet.upsertSession(appOrigin: payload.appOrigin, providers: providerIds)
            }

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
        for gc in wallet.giftedCredentials {
            if providers[gc.providerId] == nil && !isGiftedCredentialExpired(gc) && gc.usedTokens < gc.maxTokens {
                providers[gc.providerId] = [
                    "available": true,
                    "authMethod": "api_key",
                ]
            }
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

        let origin = pairedOrigin ?? "relay"
        let allowanceCheck = wallet.checkAllowance(origin: origin, providerId: providerId)
        if !allowanceCheck.allowed {
            sendRelayError(requestId: requestId, code: "QUOTA_EXCEEDED", message: allowanceCheck.reason ?? "Token allowance exceeded")
            return
        }

        let headers = json["headers"] as? [String: String] ?? [:]
        let bodyString = json["body"] as? String

        Task {
            await MainActor.run { requestCount += 1 }

            // 0. Group gift pin. If the active group pins a specific gift for
            // this provider, short-circuit all routing — the gift's relay
            // carries the request end-to-end. This matches the extension's
            // background resolver. Computed here (not inside the `do` block)
            // so the existing fall-through logic below can consult it.
            let pairedOriginLocal = await MainActor.run { self.pairedOrigin ?? "relay" }
            let groupForRouting = await MainActor.run { wallet.groupForOrigin(pairedOriginLocal) }
            let pinnedGift: GiftedCredential? = await MainActor.run {
                guard let g = groupForRouting, g.providerId == providerId, let gid = g.giftId else { return nil }
                return wallet.giftedCredentials.first {
                    $0.giftId == gid && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
                }
            }

            // 0b. Cross-family gift route. The group pins a gift whose
            // provider differs from what the app requested, a model is
            // set, and the pair is translatable. Recipient translates
            // request+response, gift relay carries the translated call.
            let engineForProbe = TranslationEngine.shared
            let srcModelForGift = RoutingResolver.parseModel(from: bodyString?.data(using: .utf8))
            let crossFamilyGift: (GiftedCredential, RoutingTranslation)? = await MainActor.run {
                guard let g = groupForRouting,
                      g.providerId != providerId,
                      let gid = g.giftId,
                      let model = g.model, !model.isEmpty,
                      let srcModel = srcModelForGift,
                      engineForProbe.shouldTranslate(srcProviderId: providerId, dstProviderId: g.providerId),
                      let gc = wallet.giftedCredentials.first(where: {
                          $0.giftId == gid && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
                      })
                else { return nil }
                return (gc, RoutingTranslation(
                    srcProviderId: providerId,
                    dstProviderId: g.providerId,
                    srcModel: srcModel,
                    dstModel: model
                ))
            }

            // If a cross-family gift route is active, handle it and return.
            // This must be checked BEFORE the regular routing resolver so a
            // cross-family gift wins over all other resolution paths.
            if let (gc, translation) = crossFamilyGift {
                await self.handleRelayRequestWithGiftTranslation(
                    requestId: requestId,
                    originalProviderId: providerId,
                    translation: translation,
                    gc: gc,
                    method: method,
                    headers: headers,
                    bodyString: bodyString,
                    wallet: wallet
                )
                return
            }

            do {
                // Resolve routing FIRST. The routing resolver inspects the
                // group for this origin and decides between: cross-family
                // translation, same-family swap, direct credential lookup,
                // or no-match (returns nil). Putting this before the gift /
                // ownCred checks matches the extension's resolution order
                // and lets routing rescue requests that would otherwise hit
                // NO_CREDENTIAL (the app calls provider X but the user only
                // has a credential for provider Y in the same family).
                let routing = await self.resolveRelayRouting(
                    requestedProviderId: providerId,
                    bodyString: bodyString,
                    wallet: wallet
                )

                // 1. Cross-family translation path. Skipped when a group-pinned
                // gift is present — gifts carry their own relay/endpoint so
                // there's nothing to translate on our side.
                if pinnedGift == nil, let routing, let translation = routing.translation {
                    await self.handleRelayRequestWithTranslation(
                        requestId: requestId,
                        originalProviderId: providerId,
                        translation: translation,
                        routedCredential: routing.credential,
                        method: method,
                        headers: headers,
                        bodyString: bodyString,
                        wallet: wallet
                    )
                    return
                }

                // 2. Same-family swap path. Two providers in the same family
                // (e.g. Groq → OpenAI) speak identical wire formats, so we
                // skip translation entirely and just rewrite URL + swap key
                // + (optionally) override the body's model field.
                if pinnedGift == nil, let routing, let swapTo = routing.swapToProviderId {
                    await self.handleRelayRequestWithSwap(
                        requestId: requestId,
                        originalProviderId: providerId,
                        swapToProviderId: swapTo,
                        swapDstModel: routing.swapDstModel,
                        routedCredential: routing.credential,
                        method: method,
                        headers: headers,
                        bodyString: bodyString,
                        wallet: wallet
                    )
                    return
                }

                // 3. Pass-through. Either routing returned a direct-match
                // credential (routing.credential.providerId == providerId),
                // or routing returned nil (no match). Gift preferences still
                // apply here — a user can explicitly prefer a gift over
                // their own key for a given provider. A group-pinned gift
                // (computed above as `pinnedGift`) overrides both.
                let prefs = await MainActor.run { wallet.giftPreferences }
                let giftedCreds = await MainActor.run { wallet.giftedCredentials }
                let ownCred = routing?.credential

                var useGift: GiftedCredential?
                if let pinnedGift {
                    useGift = pinnedGift
                } else if let preferredGiftId = prefs[providerId],
                   let gc = giftedCreds.first(where: {
                       $0.giftId == preferredGiftId && $0.providerId == providerId
                       && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
                   }) {
                    useGift = gc
                } else if ownCred == nil {
                    useGift = giftedCreds.first(where: {
                        $0.providerId == providerId && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
                    })
                }

                if let gc = useGift {
                    let filteredHeaders = headers.filter {
                        !["host", "authorization", "x-api-key"].contains($0.key.lowercased())
                    }
                    for try await event in proxyViaGiftRelay(
                        giftedCredential: gc,
                        requestId: requestId,
                        providerId: providerId,
                        url: urlString,
                        method: method,
                        headers: filteredHeaders,
                        body: bodyString
                    ) {
                        switch event {
                        case .meta(let status, let statusText, let hdrs):
                            var filtered = hdrs
                            for h in sensitiveResponseHeaders { filtered.removeValue(forKey: h) }
                            self.sendJSON([
                                "type": "relay:response:meta",
                                "requestId": requestId,
                                "status": status,
                                "statusText": statusText,
                                "headers": filtered,
                            ])
                        case .chunk(let chunk):
                            self.sendJSON([
                                "type": "relay:response:chunk",
                                "requestId": requestId,
                                "chunk": chunk,
                            ])
                        case .done:
                            self.sendJSON([
                                "type": "relay:response:done",
                                "requestId": requestId,
                            ])
                        case .usage(let giftId, let usedTokens):
                            await MainActor.run { wallet.updateGiftedCredentialUsage(giftId: giftId, usedTokens: usedTokens) }
                        }
                    }

                    let giftOrigin = await MainActor.run { self.pairedOrigin ?? "relay" }
                    await MainActor.run {
                        wallet.logRequest(
                            appOrigin: giftOrigin,
                            providerId: providerId,
                            method: method,
                            url: urlString,
                            statusCode: 0,
                            requestBody: bodyString?.data(using: .utf8),
                            responseBody: nil
                        )
                    }
                    return
                }

                guard let credential = ownCred else {
                    // No direct credential AND no routing rule fired. Build
                    // an actionable message that tells the user exactly
                    // what's wrong and what to do about it: which provider
                    // the app asked for, what credentials they have (if
                    // any), and which group is currently routing this app.
                    let allCreds = await MainActor.run { wallet.credentials.map { $0.providerId } }
                    let uniqueCreds = Array(Set(allCreds)).sorted()
                    let originForLookup = await MainActor.run { self.pairedOrigin } ?? "relay"
                    let group = await MainActor.run { wallet.groupForOrigin(originForLookup) }
                    let message = Self.buildNoCredentialMessage(
                        requestedProviderId: providerId,
                        userCredentialProviderIds: uniqueCreds,
                        group: group
                    )
                    sendRelayError(requestId: requestId, code: "NO_CREDENTIAL", message: message)
                    return
                }

                let apiKey = try await MainActor.run {
                    try wallet.decryptKey(for: credential)
                }

                var request = URLRequest(url: url)
                request.httpMethod = method
                request.timeoutInterval = 120

                let finalBody = injectStreamUsageOptions(providerId: providerId, body: bodyString)
                if let finalBody {
                    request.httpBody = finalBody.data(using: .utf8)
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

    /// Cross-family routing for relay-routed requests. Uses pairedOrigin
    /// (the desktop app's actual origin) for the group lookup, so per-app
    /// routing is fully functional via the relay path.
    private func resolveRelayRouting(
        requestedProviderId: String,
        bodyString: String?,
        wallet: WalletStore
    ) async -> RoutingDecision? {
        let origin = await MainActor.run { self.pairedOrigin } ?? "relay"
        let group = await MainActor.run { wallet.groupForOrigin(origin) }
        let allCreds = await MainActor.run { wallet.credentials }
        let srcModel = RoutingResolver.parseModel(from: bodyString?.data(using: .utf8))
        return RoutingResolver.resolve(
            requestedProviderId: requestedProviderId,
            requestedModel: srcModel,
            group: group,
            credentials: allCreds
        )
    }

    /// Cross-family translation path for relay-routed requests. Mirrors the
    /// existing pass-through relay flow but inserts: translateRequest before
    /// send, destination URL via rewriteProxyUrl, destination credential
    /// auth, and translateResponse / stream translator on the response.
    private func handleRelayRequestWithTranslation(
        requestId: String,
        originalProviderId: String,
        translation: RoutingTranslation,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        bodyString: String?,
        wallet: WalletStore
    ) async {
        let engine = TranslationEngine.shared
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyString?.data(using: .utf8))

        do {
            let ctxJson = try engine.buildTranslationContext(
                srcProviderId: translation.srcProviderId,
                dstProviderId: translation.dstProviderId,
                srcModel: translation.srcModel,
                dstModel: translation.dstModel,
                isStreaming: isStreaming,
                requestId: requestId
            )
            let translatedBody = try engine.translateRequest(contextJson: ctxJson, body: bodyString ?? "")

            guard let urlString = engine.rewriteProxyUrl(
                dstProviderId: translation.dstProviderId,
                model: translation.dstModel,
                stream: isStreaming
            ), let url = URL(string: urlString) else {
                sendRelayError(requestId: requestId, code: "TRANSLATION_FAILED", message: "rewriteProxyUrl returned null")
                return
            }

            let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            // Inject stream_options for openai-family providers that need it.
            let injected = injectStreamUsageOptions(providerId: translation.dstProviderId, body: translatedBody) ?? translatedBody
            request.httpBody = injected.data(using: .utf8)

            for (key, value) in headers {
                let lower = key.lowercased()
                if ["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower) { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            Credential.applyAuth(
                to: &request,
                providerId: translation.dstProviderId,
                authMethod: routedCredential.authMethod,
                apiKey: dstApiKey
            )

            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                sendRelayError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
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

            // Non-2xx: pass body through verbatim, no translation.
            if !(200..<300).contains(httpResponse.statusCode) {
                var buffer = Data()
                for try await byte in bytes {
                    buffer.append(byte)
                    if buffer.count >= 4096 || byte == 0x0A {
                        if let chunk = String(data: buffer, encoding: .utf8) {
                            sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": chunk])
                        }
                        buffer.removeAll()
                    }
                }
                if !buffer.isEmpty, let chunk = String(data: buffer, encoding: .utf8) {
                    sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": chunk])
                }
                sendJSON(["type": "relay:response:done", "requestId": requestId])
                let origin = await MainActor.run { self.pairedOrigin } ?? "relay"
                await MainActor.run {
                    wallet.logRequest(
                        appOrigin: origin,
                        providerId: originalProviderId,
                        method: method,
                        url: urlString,
                        statusCode: httpResponse.statusCode,
                        requestBody: bodyString?.data(using: .utf8),
                        responseBody: nil,
                        actualProviderId: translation.dstProviderId,
                        actualModel: translation.dstModel,
                        groupId: wallet.groupForOrigin(origin)?.id
                    )
                }
                return
            }

            // 2xx + streaming: feed raw bytes through the SSE stream
            // translator. We CANNOT use bytes.lines here because Apple's
            // AsyncLineSequence collapses adjacent line terminators —
            // i.e. it does not yield empty strings for the blank lines
            // that separate SSE events. The OpenAI / Anthropic stream
            // parsers in @byoky/core split frames on `\n\n`, so dropping
            // the blank lines means the parser never sees a frame
            // terminator and silently swallows the entire stream.
            //
            // Instead: accumulate raw bytes into a small buffer, flush
            // the buffer to the JS bridge on every newline or every 4KB.
            // The parser reassembles `\n\n` framing from the resulting
            // chunks and emits events as soon as a frame is complete.
            //
            // 2xx + non-streaming: accumulate full body, translateResponse once.
            if isStreaming {
                let streamHandle = try engine.createStreamTranslator(contextJson: ctxJson)
                var releasedExplicitly = false
                var buffer = Data()
                defer {
                    if !releasedExplicitly {
                        engine.releaseStreamTranslator(handle: streamHandle)
                    }
                }
                for try await byte in bytes {
                    buffer.append(byte)
                    if buffer.count >= 4096 || byte == 0x0A {
                        if let s = String(data: buffer, encoding: .utf8) {
                            let translated = try engine.processStreamChunk(handle: streamHandle, chunk: s)
                            if !translated.isEmpty {
                                sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": translated])
                            }
                        }
                        buffer.removeAll(keepingCapacity: true)
                    }
                }
                if !buffer.isEmpty, let s = String(data: buffer, encoding: .utf8) {
                    let translated = try engine.processStreamChunk(handle: streamHandle, chunk: s)
                    if !translated.isEmpty {
                        sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": translated])
                    }
                }
                let trailing = try engine.flushStreamTranslator(handle: streamHandle)
                releasedExplicitly = true
                if !trailing.isEmpty {
                    sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": trailing])
                }
            } else {
                var accumulated = Data()
                for try await byte in bytes {
                    accumulated.append(byte)
                }
                let upstreamBody = String(data: accumulated, encoding: .utf8) ?? ""
                let translated = try engine.translateResponse(contextJson: ctxJson, body: upstreamBody)
                sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": translated])
            }

            sendJSON(["type": "relay:response:done", "requestId": requestId])

            let logOrigin = await MainActor.run { self.pairedOrigin } ?? "relay"
            await MainActor.run {
                wallet.logRequest(
                    appOrigin: logOrigin,
                    providerId: originalProviderId,
                    method: method,
                    url: urlString,
                    statusCode: httpResponse.statusCode,
                    requestBody: bodyString?.data(using: .utf8),
                    responseBody: nil,
                    actualProviderId: translation.dstProviderId,
                    actualModel: translation.dstModel,
                    groupId: wallet.groupForOrigin(logOrigin)?.id
                )
            }
        } catch {
            sendRelayError(requestId: requestId, code: "TRANSLATION_FAILED", message: error.localizedDescription)
        }
    }

    /// Cross-family translation via a gift relay. Mirrors
    /// `handleRelayRequestWithTranslation` but routes the upstream call
    /// through the gift relay instead of URLSession — the sender holds the
    /// destination API key and the recipient only handles translation.
    ///
    /// Pipeline:
    ///   1. Translate request body src → dst
    ///   2. Rewrite URL to the destination provider's endpoint
    ///   3. Send translated body + dst URL through the gift relay
    ///   4. On response: stream-translate each chunk (streaming) or buffer
    ///      then translate once (non-streaming), dst → src
    ///   5. Non-2xx from upstream passes through verbatim (no translation)
    private func handleRelayRequestWithGiftTranslation(
        requestId: String,
        originalProviderId: String,
        translation: RoutingTranslation,
        gc: GiftedCredential,
        method: String,
        headers: [String: String],
        bodyString: String?,
        wallet: WalletStore
    ) async {
        let engine = TranslationEngine.shared
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyString?.data(using: .utf8))

        do {
            let ctxJson = try engine.buildTranslationContext(
                srcProviderId: translation.srcProviderId,
                dstProviderId: translation.dstProviderId,
                srcModel: translation.srcModel,
                dstModel: translation.dstModel,
                isStreaming: isStreaming,
                requestId: requestId
            )
            let translatedBody = try engine.translateRequest(contextJson: ctxJson, body: bodyString ?? "")

            guard let urlString = engine.rewriteProxyUrl(
                dstProviderId: translation.dstProviderId,
                model: translation.dstModel,
                stream: isStreaming
            ) else {
                sendRelayError(requestId: requestId, code: "TRANSLATION_FAILED", message: "rewriteProxyUrl returned null")
                return
            }

            let filteredHeaders = headers.filter {
                let lower = $0.key.lowercased()
                return !["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower)
            }

            // Inject stream_options for openai-family providers that need it.
            let finalBody = injectStreamUsageOptions(providerId: translation.dstProviderId, body: translatedBody) ?? translatedBody

            // Stream translator is created lazily once we know we have a 2xx
            // streaming response. Non-streaming buffers into accumulatedBody.
            var streamHandle: Int?
            var isUpstreamError = false
            var accumulatedBody = Data()
            var receivedStatus = 0
            var handleReleased = false

            defer {
                if let handle = streamHandle, !handleReleased {
                    engine.releaseStreamTranslator(handle: handle)
                }
            }

            for try await event in proxyViaGiftRelay(
                giftedCredential: gc,
                requestId: requestId,
                providerId: translation.dstProviderId,
                url: urlString,
                method: method,
                headers: filteredHeaders,
                body: finalBody
            ) {
                switch event {
                case .meta(let status, let statusText, let hdrs):
                    receivedStatus = status
                    isUpstreamError = !(200..<300).contains(status)
                    var filtered = hdrs
                    for h in sensitiveResponseHeaders { filtered.removeValue(forKey: h) }
                    self.sendJSON([
                        "type": "relay:response:meta",
                        "requestId": requestId,
                        "status": status,
                        "statusText": statusText,
                        "headers": filtered,
                    ])
                    if !isUpstreamError && isStreaming {
                        streamHandle = try engine.createStreamTranslator(contextJson: ctxJson)
                    }
                case .chunk(let chunk):
                    if isUpstreamError {
                        // Pass error bodies through verbatim — they're not
                        // in the src dialect but translating them would
                        // swallow the provider's real error message.
                        self.sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": chunk])
                    } else if let handle = streamHandle {
                        let translated = try engine.processStreamChunk(handle: handle, chunk: chunk)
                        if !translated.isEmpty {
                            self.sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": translated])
                        }
                    } else if let data = chunk.data(using: .utf8) {
                        // Non-streaming path: accumulate for one-shot translation.
                        accumulatedBody.append(data)
                    }
                case .done:
                    if let handle = streamHandle {
                        let trailing = try engine.flushStreamTranslator(handle: handle)
                        engine.releaseStreamTranslator(handle: handle)
                        handleReleased = true
                        if !trailing.isEmpty {
                            self.sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": trailing])
                        }
                    } else if !isUpstreamError && !isStreaming {
                        let upstreamBody = String(data: accumulatedBody, encoding: .utf8) ?? ""
                        let translated = try engine.translateResponse(contextJson: ctxJson, body: upstreamBody)
                        self.sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": translated])
                    }
                    self.sendJSON(["type": "relay:response:done", "requestId": requestId])
                case .usage(let giftId, let usedTokens):
                    await MainActor.run { wallet.updateGiftedCredentialUsage(giftId: giftId, usedTokens: usedTokens) }
                }
            }

            let logOrigin = await MainActor.run { self.pairedOrigin } ?? "relay"
            await MainActor.run {
                wallet.logRequest(
                    appOrigin: logOrigin,
                    providerId: originalProviderId,
                    method: method,
                    url: urlString,
                    statusCode: receivedStatus,
                    requestBody: bodyString?.data(using: .utf8),
                    responseBody: nil,
                    actualProviderId: translation.dstProviderId,
                    actualModel: translation.dstModel,
                    groupId: wallet.groupForOrigin(logOrigin)?.id
                )
            }
        } catch {
            sendRelayError(requestId: requestId, code: "TRANSLATION_FAILED", message: error.localizedDescription)
        }
    }

    /// Same-family swap path for relay-routed requests. Two providers in the
    /// same translation family (e.g. Groq → OpenAI) share an identical wire
    /// format, so we skip the JS translation bridge entirely and just:
    ///   - rewrite the upstream URL to the destination provider's chat endpoint
    ///   - (optionally) override the request body's `model` field when the
    ///     group pins a specific destination model
    ///   - swap in the destination credential for auth
    ///   - forward the response bytes unchanged
    ///
    /// This is strictly simpler than handleRelayRequestWithTranslation — no
    /// translateRequest, no stream translator, no translateResponse.
    private func handleRelayRequestWithSwap(
        requestId: String,
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        bodyString: String?,
        wallet: WalletStore
    ) async {
        let engine = TranslationEngine.shared
        let bodyData = bodyString?.data(using: .utf8)
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyData)
        // Use the group's destination model for URL building when present,
        // otherwise fall back to whatever the SDK sent. Most openai-family
        // providers ignore the model in the URL (it comes from the body),
        // but Gemini-shaped URLs use it — harmless here since this path
        // only runs for openai-family → openai-family swaps, but we pass
        // the real model anyway to keep rewriteProxyUrl honest.
        let modelForUrl = swapDstModel ?? RoutingResolver.parseModel(from: bodyData) ?? ""

        do {
            guard let rewrittenUrlString = engine.rewriteProxyUrl(
                dstProviderId: swapToProviderId,
                model: modelForUrl,
                stream: isStreaming
            ), let url = URL(string: rewrittenUrlString) else {
                sendRelayError(requestId: requestId, code: "SWAP_FAILED", message: "rewriteProxyUrl returned null for \(swapToProviderId)")
                return
            }

            // Substitute the body's `model` field with the group's pinned
            // destination model when set. Same-family providers all accept
            // a JSON body with a top-level `model` string, so a surgical
            // JSON edit is safe and minimal.
            var forwardedBody = bodyString
            if let dstModel = swapDstModel, !dstModel.isEmpty {
                forwardedBody = rewriteModelInJsonBody(bodyString, to: dstModel)
            }
            // Inject stream_options for openai-family providers that need it.
            let injectedBody = injectStreamUsageOptions(providerId: swapToProviderId, body: forwardedBody) ?? forwardedBody

            let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            if let injectedBody {
                request.httpBody = injectedBody.data(using: .utf8)
            }

            for (key, value) in headers {
                let lower = key.lowercased()
                if ["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower) { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            Credential.applyAuth(
                to: &request,
                providerId: swapToProviderId,
                authMethod: routedCredential.authMethod,
                apiKey: dstApiKey
            )

            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                sendRelayError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
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

            // Forward the response body verbatim (success or error — no
            // translation). The wire format is identical on both sides.
            var buffer = Data()
            var fullResponseData = Data()
            for try await byte in bytes {
                buffer.append(byte)
                fullResponseData.append(byte)
                if buffer.count >= 4096 || byte == 0x0A {
                    if let chunk = String(data: buffer, encoding: .utf8) {
                        sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": chunk])
                    }
                    buffer.removeAll()
                }
            }
            if !buffer.isEmpty, let chunk = String(data: buffer, encoding: .utf8) {
                sendJSON(["type": "relay:response:chunk", "requestId": requestId, "chunk": chunk])
            }
            sendJSON(["type": "relay:response:done", "requestId": requestId])

            let logOrigin = await MainActor.run { self.pairedOrigin } ?? "relay"
            let responseBody = String(data: fullResponseData, encoding: .utf8)
            await MainActor.run {
                wallet.logRequest(
                    appOrigin: logOrigin,
                    providerId: originalProviderId,
                    method: method,
                    url: rewrittenUrlString,
                    statusCode: httpResponse.statusCode,
                    requestBody: bodyData,
                    responseBody: responseBody,
                    actualProviderId: swapToProviderId,
                    actualModel: swapDstModel,
                    groupId: wallet.groupForOrigin(logOrigin)?.id
                )
            }
        } catch {
            sendRelayError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
        }
    }

    /// Surgically rewrite the top-level `model` field of a JSON request body
    /// to `newModel`. Returns the original body unchanged if parsing fails
    /// (we'd rather pass through and let the destination return a real error
    /// than silently corrupt the request). Used by the same-family swap path
    /// when the group pins a destination model.
    private func rewriteModelInJsonBody(_ body: String?, to newModel: String) -> String? {
        guard let body, let data = body.data(using: .utf8),
              var json = try? JSONSerialization.jsonObject(with: data, options: [.mutableContainers]) as? [String: Any] else {
            return body
        }
        json["model"] = newModel
        guard let rewritten = try? JSONSerialization.data(withJSONObject: json),
              let str = String(data: rewritten, encoding: .utf8) else {
            return body
        }
        return str
    }

    /// Compose a human-readable, actionable error message for the
    /// `NO_CREDENTIAL` failure mode. Pulled into a static helper so it can
    /// be unit-tested independently of the relay pipeline.
    ///
    /// Three branches by data shape:
    ///   1. Group is bound to a provider != the requested one (i.e. user
    ///      configured a routing rule but the destination has no key).
    ///      "Bound to OpenAI but you have no OpenAI key. Add one or
    ///      rebind the group."
    ///   2. Group is bound to the requested provider (or no group at all)
    ///      and the user has *some* credentials.
    ///      "Add a Foo key, or move this app to a group that uses one of
    ///      your existing keys (you have: Bar, Baz)."
    ///   3. User has no credentials at all.
    ///      "Add a Foo key in Wallet."
    static func buildNoCredentialMessage(
        requestedProviderId: String,
        userCredentialProviderIds: [String],
        group: Group?
    ) -> String {
        let req = requestedProviderId
        // An empty providerId means the sentinel default group — no routing,
        // so treat as if no group were set.
        let groupBinding = group?.providerId.nilIfEmpty
        // Case 1: a group is routing this app to a provider that has no credential.
        if let groupBinding, groupBinding != req {
            return "No \(groupBinding) API key found. Add a \(groupBinding) key to your wallet, or assign this app to a provider you already have a key for."
        }
        // Case 2: user has other credentials but not for the requested provider.
        if !userCredentialProviderIds.isEmpty {
            let list = userCredentialProviderIds.joined(separator: ", ")
            return "No \(req) API key found. You have keys for: \(list). Add a \(req) key, or assign this app to one of those providers."
        }
        // Case 3: user has no credentials at all.
        return "No API keys in your wallet. Add a key for any provider to get started."
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

    private func sendVaultOffer(appOrigin: String) {
        guard let wallet else { return }
        let providerIds = Array(Set(wallet.credentials.map { $0.providerId }))
        Task {
            guard let result = await wallet.createVaultAppSession(
                appOrigin: appOrigin,
                providerIds: providerIds
            ) else {
                await MainActor.run {
                    self.sendJSON([
                        "type": "relay:vault:offer:failed",
                        "reason": wallet.cloudVaultTokenExpired ? "token_expired"
                            : !wallet.cloudVaultEnabled ? "vault_disabled"
                            : "session_create_failed",
                    ])
                }
                return
            }
            await MainActor.run {
                self.sendJSON([
                    "type": "relay:vault:offer",
                    "vaultUrl": result.vaultUrl,
                    "appSessionToken": result.appSessionToken,
                ])
            }
        }
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let str = String(data: data, encoding: .utf8) else { return }
        wsTask?.send(.string(str)) { _ in }
    }
}
