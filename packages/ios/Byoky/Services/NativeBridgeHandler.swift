import Foundation
import WebKit

/// Handles messages from the injected JavaScript bridge in app WebViews,
/// mimicking the browser extension's content script + background proxy.
/// This lets web apps opened in the in-wallet browser auto-connect to the
/// local wallet; their requests are proxied on-device with the user's keys.
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

    /// WebKit exposes the message handler to every frame, including
    /// sandboxed iframes and `about:srcdoc` content an app embeds. Only the
    /// app's own top-level page may talk to the wallet.
    nonisolated func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        MainActor.assumeIsolated {
            let frame = message.frameInfo
            let origin = frame.securityOrigin
            guard Self.isTrustedFrame(
                isMainFrame: frame.isMainFrame,
                scheme: origin.protocol,
                host: origin.host,
                port: origin.port,
                appOrigin: appOrigin
            ),
            let body = message.body as? [String: Any],
            let type = body["type"] as? String else { return }
            handleMessage(type: type, body: body)
        }
    }

    /// The sender is the main frame of the app's own https origin (scheme,
    /// host and port). `port` is WebKit's: 0 means the scheme's default.
    nonisolated static func isTrustedFrame(isMainFrame: Bool, scheme: String, host: String, port: Int, appOrigin: String) -> Bool {
        guard isMainFrame, scheme.lowercased() == "https",
              let app = URL(string: appOrigin), app.scheme == "https",
              let appHost = app.host else { return false }
        let expectedPort = app.port.map { $0 == 443 ? 0 : $0 } ?? 0
        let actualPort = port == 443 ? 0 : port
        return host.lowercased() == appHost.lowercased() && actualPort == expectedPort
    }

    /// Request ids are page-supplied; only accept the SDK's shape (UUIDs and
    /// similar) so nothing odd ever reaches the reply path.
    nonisolated static func isValidRequestId(_ requestId: String) -> Bool {
        requestId.range(of: #"^[A-Za-z0-9_-]{1,128}$"#, options: .regularExpression) != nil
    }

    private func handleMessage(type: String, body: [String: Any]) {
        let requestId = body["requestId"] as? String ?? ""
        let payload = body["payload"] as? [String: Any]

        // Disconnect has no reply; everything else needs a usable request id.
        if type == "BYOKY_DISCONNECT" {
            handleDisconnect(payload: payload)
            return
        }
        guard Self.isValidRequestId(requestId) else { return }

        switch type {
        case "BYOKY_CONNECT_REQUEST":
            handleConnect(requestId: requestId, reconnectOnly: payload?["reconnectOnly"] as? Bool == true)
        case "BYOKY_PROXY_REQUEST":
            handleProxy(body)
        case "BYOKY_SESSION_STATUS":
            handleSessionStatus(requestId: requestId, payload: payload)
        case "BYOKY_SESSION_USAGE":
            handleSessionUsage(requestId: requestId)
        default:
            break
        }
    }

    // MARK: - Session

    /// The page holds the current session key and the session still exists
    /// (not revoked in Connected Apps, not expired, not disconnected).
    private func isSessionValid(_ presentedKey: String?) -> Bool {
        guard let sessionKey, let presentedKey, presentedKey == sessionKey else { return false }
        return wallet.hasActiveSession(appOrigin: appOrigin)
    }

    private func handleDisconnect(payload: [String: Any]?) {
        guard isSessionValid(payload?["sessionKey"] as? String) else { return }
        sessionKey = nil
        wallet.endSession(appOrigin: appOrigin)
    }

    // MARK: - Connect

    private func handleConnect(requestId: String, reconnectOnly: Bool) {
        // Revoked in Connected Apps: no silent reconnect until the user opens
        // the app from the Apps grid again.
        if wallet.isAppAccessRevoked(origin: appOrigin) {
            sessionKey = nil
            deliver(requestId: requestId, message: [
                "type": "BYOKY_ERROR",
                "requestId": requestId,
                "payload": reconnectOnly
                    ? ["code": "NO_SESSION", "message": "No active session for this origin"]
                    : ["code": "USER_REJECTED", "message": "Access to this wallet was revoked. Open the app from Byoky's Apps tab to reconnect."],
            ])
            return
        }

        var providers: [String: [String: Any]] = [:]
        for credential in wallet.credentials {
            providers[credential.providerId] = [
                "available": true,
                "authMethod": credential.authMethod == .apiKey ? "api_key" : "oauth",
            ]
        }

        let key = "byk_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
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

        guard isSessionValid(msg["sessionKey"] as? String) else {
            deliverProxyError(requestId: requestId, code: "SESSION_EXPIRED", message: "Invalid or expired session")
            return
        }

        // For requiresCustomBaseUrl providers (Azure, Ollama, LM Studio) we
        // can't validate the URL against a fixed host — the real host lives
        // on the credential's baseUrl, which we don't have yet. Parse the
        // URL now for transport; proxyDirect revalidates with the resolved
        // credential's baseUrl before issuing the fetch.
        let providerCfg = Provider.find(providerId)
        let url: URL
        if providerCfg?.requiresCustomBaseUrl == true {
            guard let parsed = URL(string: urlString) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "URL doesn't parse")
                return
            }
            url = parsed
        } else {
            guard let validated = Provider.validateUrl(urlString, for: providerId) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "URL doesn't match provider")
                return
            }
            url = validated
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

            // 3. Pass-through
            guard let credential = routing?.credential else {
                let uniqueCreds = Array(Set(allCreds.map(\.providerId))).sorted()
                let message = RoutingResolver.noCredentialMessage(
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
            // Post-resolve validation for requiresCustomBaseUrl providers.
            // The initial parse in handleProxy was permissive; now we know
            // the credential and can enforce that the URL actually points
            // at the credential's registered host.
            if Provider.find(providerId)?.requiresCustomBaseUrl == true {
                if let message = Provider.missingEndpointMessage(providerId: providerId, credentialBaseUrl: credential.baseUrl) {
                    deliverProxyError(requestId: requestId, code: "ENDPOINT_REQUIRED", message: message)
                    return
                }
                if Provider.validateUrl(urlString, for: providerId, credentialBaseUrl: credential.baseUrl) == nil {
                    deliverProxyError(requestId: requestId, code: "INVALID_URL",
                                       message: "URL doesn't match credential's registered base URL")
                    return
                }
            }

            let apiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120

            // Setup tokens only work for Claude-Code-shaped requests.
            var forwardedBody = bodyString
            var toolNameMap: [String: String] = [:]
            if ClaudeCodeShaping.applies(providerId: providerId, authMethod: credential.authMethod) {
                (forwardedBody, toolNameMap) = ClaudeCodeShaping.shape(body: bodyString)
            }

            let finalBody = injectStreamUsageOptions(providerId: providerId, body: forwardedBody)
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

            // Give the app back its own tool names.
            let toolNameRewriter = (200..<300).contains(httpResponse.statusCode)
                ? ClaudeCodeResponseRewriter(toolNameMap: toolNameMap, streaming: isEventStream(httpResponse))
                : nil
            await streamResponse(requestId: requestId, httpResponse: httpResponse, bytes: bytes, rewriter: toolNameRewriter)

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

            if let message = Provider.missingEndpointMessage(providerId: translation.dstProviderId, credentialBaseUrl: credential.baseUrl) {
                deliverProxyError(requestId: requestId, code: "ENDPOINT_REQUIRED", message: message)
                return
            }
            guard let urlString = engine.rewriteProxyUrl(
                dstProviderId: translation.dstProviderId,
                model: translation.dstModel,
                stream: isStreaming,
                overrideBaseUrl: Provider.baseUrlOverride(for: translation.dstProviderId, credentialBaseUrl: credential.baseUrl)
            ) else {
                deliverProxyError(requestId: requestId, code: "TRANSLATION_FAILED", message: "rewriteProxyUrl returned null")
                return
            }
            // Check the destination before any key is attached.
            guard let url = Provider.validateUrl(urlString, for: translation.dstProviderId, credentialBaseUrl: credential.baseUrl) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "Destination URL doesn't match the provider")
                return
            }

            let dstApiKey = try wallet.decryptKey(for: credential)

            // A setup-token destination needs the translated (now Anthropic-
            // shaped) body in Claude Code shape too.
            var outboundBody = translatedBody
            var toolNameMap: [String: String] = [:]
            if ClaudeCodeShaping.applies(providerId: translation.dstProviderId, authMethod: credential.authMethod) {
                let shaped = ClaudeCodeShaping.shape(body: translatedBody)
                outboundBody = shaped.body ?? translatedBody
                toolNameMap = shaped.toolNameMap
            }

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            let injected = injectStreamUsageOptions(providerId: translation.dstProviderId, body: outboundBody) ?? outboundBody
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
                // Undo tool renames on the Anthropic stream first, then
                // translate it back to the app's dialect.
                let toolNameRewriter = ClaudeCodeResponseRewriter(toolNameMap: toolNameMap, streaming: true)
                let streamHandle = try engine.createStreamTranslator(contextJson: ctxJson)
                var releasedExplicitly = false
                var buffer = Data()
                var decoder = UTF8ChunkDecoder()
                defer { if !releasedExplicitly { engine.releaseStreamTranslator(handle: streamHandle) } }
                func translateAndDeliver(_ upstream: String) throws {
                    guard !upstream.isEmpty else { return }
                    deliverChunk(requestId, try engine.processStreamChunk(handle: streamHandle, chunk: upstream))
                }
                func rewriteAndTranslate(_ text: String) throws {
                    guard !text.isEmpty else { return }
                    try translateAndDeliver(toolNameRewriter?.process(text) ?? text)
                }
                for try await byte in bytes {
                    buffer.append(byte)
                    if buffer.count >= 4096 || byte == 0x0A {
                        try rewriteAndTranslate(decoder.decode(buffer))
                        buffer.removeAll(keepingCapacity: true)
                    }
                }
                try rewriteAndTranslate(decoder.decode(buffer))
                try rewriteAndTranslate(decoder.finish())
                if let tail = toolNameRewriter?.finish() {
                    try translateAndDeliver(tail)
                }
                let trailing = try engine.flushStreamTranslator(handle: streamHandle)
                releasedExplicitly = true
                deliverChunk(requestId, trailing)
            } else {
                var accumulated = Data()
                for try await byte in bytes { accumulated.append(byte) }
                var upstreamBody = String(decoding: accumulated, as: UTF8.self)
                if let toolNameRewriter = ClaudeCodeResponseRewriter(toolNameMap: toolNameMap, streaming: false) {
                    _ = toolNameRewriter.process(upstreamBody)
                    upstreamBody = toolNameRewriter.finish()
                }
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
            if let message = Provider.missingEndpointMessage(providerId: swapToProviderId, credentialBaseUrl: credential.baseUrl) {
                deliverProxyError(requestId: requestId, code: "ENDPOINT_REQUIRED", message: message)
                return
            }
            guard let rewrittenUrlString = engine.rewriteProxyUrl(
                dstProviderId: swapToProviderId, model: modelForUrl, stream: isStreaming,
                overrideBaseUrl: Provider.baseUrlOverride(for: swapToProviderId, credentialBaseUrl: credential.baseUrl)
            ) else {
                deliverProxyError(requestId: requestId, code: "SWAP_FAILED",
                                  message: "rewriteProxyUrl returned null for \(swapToProviderId)")
                return
            }
            // Check the destination before any key is attached.
            guard let url = Provider.validateUrl(rewrittenUrlString, for: swapToProviderId, credentialBaseUrl: credential.baseUrl) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "Destination URL doesn't match the provider")
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

    // MARK: - Session status / usage

    private func handleSessionStatus(requestId: String, payload: [String: Any]?) {
        deliver(requestId: requestId, message: [
            "type": "BYOKY_SESSION_STATUS_RESPONSE",
            "requestId": requestId,
            "payload": ["connected": isSessionValid(payload?["sessionKey"] as? String)],
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
        bytes: URLSession.AsyncBytes,
        rewriter: ClaudeCodeResponseRewriter? = nil
    ) async {
        deliverResponseHeaders(requestId: requestId, httpResponse: httpResponse)
        await streamRawBytes(requestId: requestId, bytes: bytes, rewriter: rewriter)
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_DONE", "requestId": requestId,
        ])
    }

    private func isEventStream(_ httpResponse: HTTPURLResponse) -> Bool {
        (httpResponse.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased().contains("text/event-stream")
    }

    private func deliverChunk(_ requestId: String, _ chunk: String) {
        guard !chunk.isEmpty else { return }
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_CHUNK",
            "requestId": requestId, "chunk": chunk,
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

    private func streamRawBytes(
        requestId: String,
        bytes: URLSession.AsyncBytes,
        rewriter: ClaudeCodeResponseRewriter? = nil
    ) async {
        var buffer = Data()
        // Reads are cut at 4 KB or a newline; the decoder carries a split
        // multi-byte character over to the next read instead of dropping it.
        var decoder = UTF8ChunkDecoder()
        func emit(_ text: String) {
            guard !text.isEmpty else { return }
            deliverChunk(requestId, rewriter?.process(text) ?? text)
        }
        do {
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count >= 4096 || byte == 0x0A {
                    emit(decoder.decode(buffer))
                    buffer.removeAll(keepingCapacity: true)
                }
            }
        } catch {}
        emit(decoder.decode(buffer))
        emit(decoder.finish())
        if let tail = rewriter?.finish() {
            deliverChunk(requestId, tail)
        }
    }

    // MARK: - Bridge delivery

    /// Hand a reply to the bridge script in the app's main frame. The request
    /// id and message travel as arguments (never spliced into script text),
    /// and the message is a JSON string, so any Unicode arrives intact.
    private func deliver(requestId: String, message: [String: Any]) {
        guard Self.isValidRequestId(requestId),
              let json = Self.encodeMessage(message) else { return }
        webView?.callAsyncJavaScript(
            "if (window.__byokyBridge) { window.__byokyBridge._deliver(requestId, message); }",
            arguments: ["requestId": requestId, "message": json],
            in: nil,
            in: .page,
            completionHandler: nil
        )
    }

    nonisolated static func encodeMessage(_ message: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: message) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deliverProxyError(requestId: String, code: String, message: String) {
        let status: Int = switch code {
        case "SESSION_EXPIRED": 401
        case "NO_CREDENTIAL", "INVALID_URL", "ENDPOINT_REQUIRED": 403
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

// MARK: - Proxy helpers

/// Upstream response headers that are never forwarded to the web app.
private let sensitiveResponseHeaders: Set<String> = [
    "server", "x-request-id", "x-cloud-trace-context",
    "set-cookie", "set-cookie2", "alt-svc", "via",
]

/// Providers that need `stream_options.include_usage` injected for streaming.
private let streamUsageProviders: Set<String> = [
    "openai", "azure-openai", "together", "deepseek",
]

/// Inject `stream_options.include_usage` into a streaming request body for
/// providers that don't report token usage in streaming responses by default,
/// so the wallet's usage stats stay accurate.
private func injectStreamUsageOptions(providerId: String, body: String?) -> String? {
    guard let body else { return nil }
    guard streamUsageProviders.contains(providerId),
          let data = body.data(using: .utf8),
          var parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          parsed["stream"] as? Bool == true else { return body }
    var streamOptions = parsed["stream_options"] as? [String: Any] ?? [:]
    guard streamOptions["include_usage"] as? Bool != true else { return body }
    streamOptions["include_usage"] = true
    parsed["stream_options"] = streamOptions
    guard let injected = try? JSONSerialization.data(withJSONObject: parsed),
          let result = String(data: injected, encoding: .utf8) else { return body }
    return result
}
