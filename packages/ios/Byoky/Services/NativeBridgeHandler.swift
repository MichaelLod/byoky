import Foundation
import WebKit

/// Handles messages from the injected JavaScript bridge in app WebViews,
/// mimicking the browser extension's content script + background proxy.
/// This lets embedded web apps (e.g. Byoky Chat) auto-connect to the
/// local wallet without relay pairing.
@MainActor
final class NativeBridgeHandler: NSObject, WKScriptMessageHandler {
    private let wallet: WalletStore
    private let appOrigin: String
    private weak var webView: WKWebView?
    private var sessionKey: String?

    init(wallet: WalletStore, appOrigin: String) {
        self.wallet = wallet
        self.appOrigin = appOrigin
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    // MARK: - WKScriptMessageHandler

    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        Task { @MainActor in
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }
            self.handleMessage(type: type, body: body)
        }
    }

    private func handleMessage(type: String, body: [String: Any]) {
        let requestId = body["requestId"] as? String ?? ""

        switch type {
        case "BYOKY_CONNECT_REQUEST":
            handleConnect(requestId: requestId)
        case "BYOKY_PROXY_REQUEST":
            handleProxy(body)
        case "BYOKY_SESSION_STATUS":
            handleSessionStatus(requestId: requestId)
        case "BYOKY_SESSION_USAGE":
            handleSessionUsage(requestId: requestId)
        case "BYOKY_DISCONNECT":
            sessionKey = nil
        default:
            break
        }
    }

    // MARK: - Connect

    private func handleConnect(requestId: String) {
        var providers: [String: [String: Any]] = [:]
        for credential in wallet.credentials {
            providers[credential.providerId] = [
                "available": true,
                "authMethod": credential.authMethod == .apiKey ? "api_key" : "oauth",
            ]
        }
        for gc in wallet.giftedCredentials where providers[gc.providerId] == nil
            && !isGiftedCredentialExpired(gc) && gc.usedTokens < gc.maxTokens {
            providers[gc.providerId] = [
                "available": true,
                "authMethod": "api_key",
            ]
        }

        let key = "native_\(UUID().uuidString.prefix(8))"
        sessionKey = key

        let providerIds = Array(Set(wallet.credentials.map(\.providerId)))
        _ = try? wallet.upsertSession(appOrigin: appOrigin, providers: providerIds)

        deliver(requestId: requestId, message: [
            "type": "BYOKY_CONNECT_RESPONSE",
            "requestId": requestId,
            "payload": [
                "sessionKey": key,
                "providers": providers,
                "proxyUrl": "",
            ] as [String: Any],
        ])
    }

    // MARK: - Proxy

    private func handleProxy(_ msg: [String: Any]) {
        guard let requestId = msg["requestId"] as? String,
              let providerId = msg["providerId"] as? String,
              let urlString = msg["url"] as? String,
              let method = msg["method"] as? String else { return }

        guard let url = Provider.validateUrl(urlString, for: providerId) else {
            deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "URL doesn't match provider")
            return
        }

        let allowanceCheck = wallet.checkAllowance(origin: appOrigin, providerId: providerId)
        if !allowanceCheck.allowed {
            deliverProxyError(requestId: requestId, code: "QUOTA_EXCEEDED",
                              message: allowanceCheck.reason ?? "Token allowance exceeded")
            return
        }

        let headers = msg["headers"] as? [String: String] ?? [:]
        let bodyString = msg["body"] as? String

        // Capture wallet state before entering Task
        let group = wallet.groupForOrigin(appOrigin)
        let allCreds = wallet.credentials
        let prefs = wallet.giftPreferences
        let giftedCreds = wallet.giftedCredentials

        Task {
            let srcModel = RoutingResolver.parseModel(from: bodyString?.data(using: .utf8))
            let routing = RoutingResolver.resolve(
                requestedProviderId: providerId,
                requestedModel: srcModel,
                group: group,
                credentials: allCreds
            )

            // 1. Cross-family translation
            if let routing, let translation = routing.translation {
                await proxyWithTranslation(
                    requestId: requestId,
                    originalProviderId: providerId,
                    translation: translation,
                    credential: routing.credential,
                    method: method, headers: headers, bodyString: bodyString
                )
                return
            }

            // 2. Same-family swap
            if let routing, let swapTo = routing.swapToProviderId {
                await proxyWithSwap(
                    requestId: requestId,
                    originalProviderId: providerId,
                    swapToProviderId: swapTo,
                    swapDstModel: routing.swapDstModel,
                    credential: routing.credential,
                    method: method, headers: headers, bodyString: bodyString
                )
                return
            }

            // 3. Pass-through (with gift preference check)
            let ownCred = routing?.credential

            var useGift: GiftedCredential?
            if let preferredGiftId = prefs[providerId],
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
                await proxyViaGift(
                    requestId: requestId, providerId: providerId,
                    urlString: urlString, method: method,
                    headers: headers.filter { !["host", "authorization", "x-api-key"].contains($0.key.lowercased()) },
                    bodyString: bodyString, gift: gc
                )
                return
            }

            guard let credential = ownCred else {
                let uniqueCreds = Array(Set(allCreds.map(\.providerId))).sorted()
                let message = RelayPairService.buildNoCredentialMessage(
                    requestedProviderId: providerId,
                    userCredentialProviderIds: uniqueCreds,
                    group: group
                )
                self.deliverProxyError(requestId: requestId, code: "NO_CREDENTIAL", message: message)
                return
            }

            // The group is the strongest routing force: when it pins a
            // model for the requested provider, rewrite the body before
            // forwarding, even though no translation/swap is needed.
            let forwardedBody: String?
            if let override = routing?.modelOverride, !override.isEmpty {
                forwardedBody = rewriteModelInJsonBody(bodyString, to: override)
            } else {
                forwardedBody = bodyString
            }

            await proxyDirect(
                requestId: requestId, providerId: providerId,
                url: url, urlString: urlString, method: method,
                headers: headers, bodyString: forwardedBody, credential: credential
            )
        }
    }

    // MARK: - Direct proxy

    private func proxyDirect(
        requestId: String, providerId: String,
        url: URL, urlString: String, method: String,
        headers: [String: String], bodyString: String?,
        credential: Credential
    ) async {
        do {
            let apiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120

            let finalBody = injectStreamUsageOptions(providerId: providerId, body: bodyString)
            if let finalBody { request.httpBody = finalBody.data(using: .utf8) }

            for (key, value) in headers {
                let lower = key.lowercased()
                if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            Credential.applyAuth(to: &request, providerId: providerId, authMethod: credential.authMethod, apiKey: apiKey)

            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return
            }

            await streamResponse(requestId: requestId, httpResponse: httpResponse, bytes: bytes)

            wallet.logRequest(
                appOrigin: appOrigin, providerId: providerId,
                method: method, url: urlString,
                statusCode: httpResponse.statusCode,
                requestBody: bodyString?.data(using: .utf8),
                responseBody: nil
            )
        } catch {
            deliverProxyError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
        }
    }

    // MARK: - Cross-family translation proxy

    private func proxyWithTranslation(
        requestId: String, originalProviderId: String,
        translation: RoutingTranslation, credential: Credential,
        method: String, headers: [String: String], bodyString: String?
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
                deliverProxyError(requestId: requestId, code: "TRANSLATION_FAILED", message: "rewriteProxyUrl returned null")
                return
            }

            let dstApiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            let injected = injectStreamUsageOptions(providerId: translation.dstProviderId, body: translatedBody) ?? translatedBody
            request.httpBody = injected.data(using: .utf8)

            for (key, value) in headers {
                let lower = key.lowercased()
                if ["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower) { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            Credential.applyAuth(to: &request, providerId: translation.dstProviderId, authMethod: credential.authMethod, apiKey: dstApiKey)

            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return
            }

            deliverResponseHeaders(requestId: requestId, httpResponse: httpResponse)

            if !(200..<300).contains(httpResponse.statusCode) {
                await streamRawBytes(requestId: requestId, bytes: bytes)
            } else if isStreaming {
                let streamHandle = try engine.createStreamTranslator(contextJson: ctxJson)
                var releasedExplicitly = false
                var buffer = Data()
                defer { if !releasedExplicitly { engine.releaseStreamTranslator(handle: streamHandle) } }
                for try await byte in bytes {
                    buffer.append(byte)
                    if buffer.count >= 4096 || byte == 0x0A {
                        if let s = String(data: buffer, encoding: .utf8) {
                            let translated = try engine.processStreamChunk(handle: streamHandle, chunk: s)
                            if !translated.isEmpty {
                                deliver(requestId: requestId, message: [
                                    "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                                    "requestId": requestId, "chunk": translated,
                                ])
                            }
                        }
                        buffer.removeAll(keepingCapacity: true)
                    }
                }
                if !buffer.isEmpty, let s = String(data: buffer, encoding: .utf8) {
                    let translated = try engine.processStreamChunk(handle: streamHandle, chunk: s)
                    if !translated.isEmpty {
                        deliver(requestId: requestId, message: [
                            "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                            "requestId": requestId, "chunk": translated,
                        ])
                    }
                }
                let trailing = try engine.flushStreamTranslator(handle: streamHandle)
                releasedExplicitly = true
                if !trailing.isEmpty {
                    deliver(requestId: requestId, message: [
                        "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                        "requestId": requestId, "chunk": trailing,
                    ])
                }
            } else {
                var accumulated = Data()
                for try await byte in bytes { accumulated.append(byte) }
                let upstreamBody = String(data: accumulated, encoding: .utf8) ?? ""
                let translated = try engine.translateResponse(contextJson: ctxJson, body: upstreamBody)
                deliver(requestId: requestId, message: [
                    "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                    "requestId": requestId, "chunk": translated,
                ])
            }

            deliver(requestId: requestId, message: [
                "type": "BYOKY_PROXY_RESPONSE_DONE", "requestId": requestId,
            ])

            wallet.logRequest(
                appOrigin: appOrigin, providerId: originalProviderId,
                method: method, url: urlString,
                statusCode: httpResponse.statusCode,
                requestBody: bodyString?.data(using: .utf8), responseBody: nil,
                actualProviderId: translation.dstProviderId,
                actualModel: translation.dstModel,
                groupId: wallet.groupForOrigin(appOrigin)?.id
            )
        } catch {
            deliverProxyError(requestId: requestId, code: "TRANSLATION_FAILED", message: error.localizedDescription)
        }
    }

    // MARK: - Same-family swap proxy

    private func proxyWithSwap(
        requestId: String, originalProviderId: String,
        swapToProviderId: String, swapDstModel: String?,
        credential: Credential,
        method: String, headers: [String: String], bodyString: String?
    ) async {
        let engine = TranslationEngine.shared
        let bodyData = bodyString?.data(using: .utf8)
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyData)
        let modelForUrl = swapDstModel ?? RoutingResolver.parseModel(from: bodyData) ?? ""

        do {
            guard let rewrittenUrlString = engine.rewriteProxyUrl(
                dstProviderId: swapToProviderId, model: modelForUrl, stream: isStreaming
            ), let url = URL(string: rewrittenUrlString) else {
                deliverProxyError(requestId: requestId, code: "SWAP_FAILED",
                                  message: "rewriteProxyUrl returned null for \(swapToProviderId)")
                return
            }

            var forwardedBody = bodyString
            if let dstModel = swapDstModel, !dstModel.isEmpty {
                forwardedBody = rewriteModelInJsonBody(forwardedBody, to: dstModel)
            }
            let injectedBody = injectStreamUsageOptions(providerId: swapToProviderId, body: forwardedBody) ?? forwardedBody

            let dstApiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            if let injectedBody { request.httpBody = injectedBody.data(using: .utf8) }

            for (key, value) in headers {
                let lower = key.lowercased()
                if ["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower) { continue }
                request.setValue(value, forHTTPHeaderField: key)
            }
            Credential.applyAuth(to: &request, providerId: swapToProviderId, authMethod: credential.authMethod, apiKey: dstApiKey)

            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return
            }

            await streamResponse(requestId: requestId, httpResponse: httpResponse, bytes: bytes)

            wallet.logRequest(
                appOrigin: appOrigin, providerId: originalProviderId,
                method: method, url: rewrittenUrlString,
                statusCode: httpResponse.statusCode,
                requestBody: bodyData, responseBody: nil,
                actualProviderId: swapToProviderId,
                actualModel: swapDstModel,
                groupId: wallet.groupForOrigin(appOrigin)?.id
            )
        } catch {
            deliverProxyError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
        }
    }

    // MARK: - Gift proxy

    private func proxyViaGift(
        requestId: String, providerId: String,
        urlString: String, method: String,
        headers: [String: String], bodyString: String?,
        gift: GiftedCredential
    ) async {
        do {
            for try await event in proxyViaGiftRelay(
                giftedCredential: gift, requestId: requestId,
                providerId: providerId, url: urlString,
                method: method, headers: headers, body: bodyString
            ) {
                switch event {
                case .meta(let status, let statusText, let hdrs):
                    var filtered = hdrs
                    for h in sensitiveResponseHeaders { filtered.removeValue(forKey: h) }
                    deliver(requestId: requestId, message: [
                        "type": "BYOKY_PROXY_RESPONSE_META", "requestId": requestId,
                        "status": status, "statusText": statusText, "headers": filtered,
                    ])
                case .chunk(let chunk):
                    deliver(requestId: requestId, message: [
                        "type": "BYOKY_PROXY_RESPONSE_CHUNK", "requestId": requestId, "chunk": chunk,
                    ])
                case .done:
                    deliver(requestId: requestId, message: [
                        "type": "BYOKY_PROXY_RESPONSE_DONE", "requestId": requestId,
                    ])
                case .usage(let giftId, let usedTokens):
                    wallet.updateGiftedCredentialUsage(giftId: giftId, usedTokens: usedTokens)
                }
            }
            wallet.logRequest(
                appOrigin: appOrigin, providerId: providerId,
                method: method, url: urlString,
                statusCode: 0, requestBody: bodyString?.data(using: .utf8),
                responseBody: nil
            )
        } catch {
            deliverProxyError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
        }
    }

    // MARK: - Session status / usage

    private func handleSessionStatus(requestId: String) {
        deliver(requestId: requestId, message: [
            "type": "BYOKY_SESSION_STATUS_RESPONSE",
            "requestId": requestId,
            "payload": ["connected": sessionKey != nil],
        ])
    }

    private func handleSessionUsage(requestId: String) {
        deliver(requestId: requestId, message: [
            "type": "BYOKY_SESSION_USAGE_RESPONSE",
            "requestId": requestId,
            "payload": [
                "requests": 0, "inputTokens": 0, "outputTokens": 0,
                "byProvider": [String: Any](),
            ] as [String: Any],
        ])
    }

    // MARK: - Response streaming helpers

    private func streamResponse(
        requestId: String,
        httpResponse: HTTPURLResponse,
        bytes: URLSession.AsyncBytes
    ) async {
        deliverResponseHeaders(requestId: requestId, httpResponse: httpResponse)
        await streamRawBytes(requestId: requestId, bytes: bytes)
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_DONE", "requestId": requestId,
        ])
    }

    private func deliverResponseHeaders(requestId: String, httpResponse: HTTPURLResponse) {
        var responseHeaders: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
            let lower = String(describing: key).lowercased()
            if sensitiveResponseHeaders.contains(lower) { continue }
            responseHeaders[lower] = String(describing: value)
        }
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_META", "requestId": requestId,
            "status": httpResponse.statusCode,
            "statusText": HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
            "headers": responseHeaders,
        ])
    }

    private func streamRawBytes(requestId: String, bytes: URLSession.AsyncBytes) async {
        var buffer = Data()
        do {
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count >= 4096 || byte == 0x0A {
                    if let chunk = String(data: buffer, encoding: .utf8) {
                        deliver(requestId: requestId, message: [
                            "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                            "requestId": requestId, "chunk": chunk,
                        ])
                    }
                    buffer.removeAll()
                }
            }
        } catch {}
        if !buffer.isEmpty, let chunk = String(data: buffer, encoding: .utf8) {
            deliver(requestId: requestId, message: [
                "type": "BYOKY_PROXY_RESPONSE_CHUNK",
                "requestId": requestId, "chunk": chunk,
            ])
        }
    }

    // MARK: - Bridge delivery

    private func deliver(requestId: String, message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        let base64 = data.base64EncodedString()
        webView?.evaluateJavaScript(
            "window.__byokyBridge._deliver('\(requestId)', '\(base64)')"
        ) { _, _ in }
    }

    private func deliverProxyError(requestId: String, code: String, message: String) {
        let status: Int = switch code {
        case "NO_CREDENTIAL": 403
        case "QUOTA_EXCEEDED": 429
        default: 500
        }
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_ERROR", "requestId": requestId,
            "status": status,
            "error": ["code": code, "message": message],
        ])
    }

    // MARK: - Helpers

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
}
