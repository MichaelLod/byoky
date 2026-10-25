import Combine
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
    private let upstream: ProxyURLSession
    private weak var webView: WKWebView?
    private var sessionKey: String?
    /// Proxied requests still running, by request id. Cancelled when the
    /// page closes or the wallet locks, so nothing keeps spending a key the
    /// user put away.
    private var inFlight: [String: Task<Void, Never>] = [:]
    private var lockObserver: AnyCancellable?

    init(wallet: WalletStore, appOrigin: String, upstream: ProxyURLSession = .shared) {
        self.wallet = wallet
        self.appOrigin = appOrigin
        self.upstream = upstream
        super.init()
        // `status` is only ever set on the main actor.
        lockObserver = wallet.$status.sink { [weak self] status in
            guard status != .unlocked else { return }
            MainActor.assumeIsolated { self?.cancelRequests() }
        }
    }

    func attach(to webView: WKWebView) {
        self.webView = webView
    }

    /// The app's page is closing: stop its requests.
    func close() {
        cancelRequests()
        lockObserver = nil
        sessionKey = nil
    }

    private func cancelRequests() {
        for task in inFlight.values { task.cancel() }
        inFlight.removeAll()
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
        case "BYOKY_PROXY_CANCEL":
            // The app aborted the request: stop the upstream call (usage up
            // to here is still charged, as when the page closes).
            inFlight[requestId]?.cancel()
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
        // A request id still in use gets nothing: replies to both would mix.
        guard inFlight[requestId] == nil else { return }

        // Apps get inference and model-listing endpoints only: no files,
        // batches, fine-tunes or account management, which would expose
        // other apps' stored data or change the account.
        guard ProxyPolicy.isAllowedRequest(method: method, url: urlString) else {
            deliverProxyError(requestId: requestId, code: ProxyPolicy.endpointNotAllowedCode,
                              message: ProxyPolicy.endpointNotAllowedMessage)
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

        let body: ProxyBody?
        do {
            body = try ProxyBody.decode(body: msg["body"] as? String, encoding: msg["bodyEncoding"] as? String)
        } catch {
            deliverProxyError(requestId: requestId, code: "INVALID_BODY", message: "The request body couldn't be decoded")
            return
        }

        // Check the allowance and hold this request's expected cost until it
        // ends, so parallel requests can't all start on what's left.
        let reservation: TokenReservation
        switch wallet.reserveTokens(origin: appOrigin, providerId: providerId,
                                    estimatedTokens: UsageParser.requestEstimate(for: body).total) {
        case .success(let held):
            reservation = held
        case .failure(let exceeded):
            deliverProxyError(requestId: requestId, code: "QUOTA_EXCEEDED", message: exceeded.reason)
            return
        }
        wallet.noteActivity()

        let headers = msg["headers"] as? [String: String] ?? [:]

        // Capture wallet state before entering Task
        let group = wallet.groupForOrigin(appOrigin)
        let allCreds = wallet.credentials

        inFlight[requestId] = Task {
            let usedTokens = await route(
                requestId: requestId, providerId: providerId,
                url: url, urlString: urlString, method: method,
                headers: headers, body: body,
                group: group, credentials: allCreds
            )
            wallet.settleReservation(reservation, usedTokens: usedTokens)
            wallet.noteActivity()
            inFlight[requestId] = nil
        }
    }

    /// Pick the route (translation, same-family swap or pass-through) and
    /// send the request. Returns the tokens to count against the app's
    /// allowance.
    private func route(
        requestId: String, providerId: String,
        url: URL, urlString: String, method: String,
        headers: [String: String], body: ProxyBody?,
        group: Group?, credentials allCreds: [Credential]
    ) async -> Int {
        let srcModel = RoutingResolver.requestedModel(
            body: body?.asText.map { Data($0.utf8) }, url: urlString, providerId: providerId
        )
        let routing = RoutingResolver.resolve(
            requestedProviderId: providerId,
            requestedModel: srcModel,
            group: group,
            credentials: allCreds
        )

        // Routing rewrites the request onto the destination's chat endpoint,
        // so only chat requests can be translated or swapped. Model lists,
        // token counting or embeddings would be mangled into billed chat calls.
        if let routing, let destination = routing.translation?.dstProviderId ?? routing.swapToProviderId,
           !TranslationEngine.shared.isChatEndpoint(providerId: providerId, url: urlString) {
            deliverProxyError(requestId: requestId, code: "ROUTING_UNSUPPORTED",
                              message: "This app is routed to \(destination), and only chat requests can be routed to another provider")
            return 0
        }

        // 1. Cross-family translation
        if let routing, let translation = routing.translation {
            return await proxyWithTranslation(
                requestId: requestId,
                originalProviderId: providerId,
                translation: translation,
                credential: routing.credential,
                method: method, urlString: urlString, headers: headers, body: body
            )
        }

        // 2. Same-family swap
        if let routing, let swapTo = routing.swapToProviderId {
            return await proxyWithSwap(
                requestId: requestId,
                originalProviderId: providerId,
                swapToProviderId: swapTo,
                swapDstModel: routing.swapDstModel,
                credential: routing.credential,
                method: method, urlString: urlString, headers: headers, body: body
            )
        }

        // 3. Pass-through
        guard let credential = routing?.credential else {
            let uniqueCreds = Array(Set(allCreds.map(\.providerId))).sorted()
            let message = RoutingResolver.noCredentialMessage(
                requestedProviderId: providerId,
                userCredentialProviderIds: uniqueCreds,
                group: group
            )
            deliverProxyError(requestId: requestId, code: "NO_CREDENTIAL", message: message)
            return 0
        }

        // The group is the strongest routing force: when it pins a
        // model for the requested provider, rewrite the body before
        // forwarding, even though no translation/swap is needed.
        var forwardedBody = body
        if let override = routing?.modelOverride, !override.isEmpty, let text = body?.asText {
            forwardedBody = rewriteModelInJsonBody(text, to: override).map(ProxyBody.text)
        }

        return await proxyDirect(
            requestId: requestId, providerId: providerId,
            url: url, urlString: urlString, method: method,
            headers: headers, body: forwardedBody, credential: credential
        )
    }

    // MARK: - Direct proxy

    private func proxyDirect(
        requestId: String, providerId: String,
        url: URL, urlString: String, method: String,
        headers: [String: String], body: ProxyBody?,
        credential: Credential
    ) async -> Int {
        var sent = false
        do {
            // Post-resolve validation for requiresCustomBaseUrl providers.
            // The initial parse in handleProxy was permissive; now we know
            // the credential and can enforce that the URL actually points
            // at the credential's registered host.
            if Provider.find(providerId)?.requiresCustomBaseUrl == true {
                if let message = Provider.missingEndpointMessage(providerId: providerId, credentialBaseUrl: credential.baseUrl) {
                    deliverProxyError(requestId: requestId, code: "ENDPOINT_REQUIRED", message: message)
                    return 0
                }
                if Provider.validateUrl(urlString, for: providerId, credentialBaseUrl: credential.baseUrl) == nil {
                    deliverProxyError(requestId: requestId, code: "INVALID_URL",
                                       message: "URL doesn't match credential's registered base URL")
                    return 0
                }
            }

            let apiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120

            // Setup tokens only work for Claude-Code-shaped requests. Binary
            // and form bodies are forwarded as they are.
            var outboundBody = body
            var toolNameMap: [String: String] = [:]
            if let text = body?.asText {
                var shaped: String? = text
                if ClaudeCodeShaping.applies(providerId: providerId, authMethod: credential.authMethod) {
                    (shaped, toolNameMap) = ClaudeCodeShaping.shape(body: text)
                }
                outboundBody = injectStreamUsageOptions(providerId: providerId, body: shaped).map(ProxyBody.text)
            }
            request.httpBody = outboundBody?.data

            applyForwardedHeaders(headers, to: &request, body: outboundBody)
            Credential.applyAuth(to: &request, providerId: providerId, authMethod: credential.authMethod, apiKey: apiKey)

            sent = true
            let (bytes, response) = try await upstream.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return 0
            }

            // Give the app back its own tool names.
            let toolNameRewriter = (200..<300).contains(httpResponse.statusCode)
                ? ClaudeCodeResponseRewriter(toolNameMap: toolNameMap, streaming: isEventStream(httpResponse))
                : nil
            var meter = UsageMeter(providerId: providerId)
            await streamResponse(requestId: requestId, httpResponse: httpResponse, bytes: bytes,
                                 rewriter: toolNameRewriter, meter: &meter)

            meter.finish()
            let usage = UsageParser.settledUsage(
                statusCode: httpResponse.statusCode, meter: meter,
                shouldEstimate: ProxyPolicy.shouldEstimateUsage(
                    upstreamProviderId: providerId, appUrl: urlString, contentType: contentType(httpResponse)
                ),
                requestBytes: body?.data.count ?? 0
            )
            wallet.logRequest(
                appOrigin: appOrigin, providerId: providerId,
                method: method, url: urlString,
                statusCode: httpResponse.statusCode,
                requestBody: body?.asText.map { Data($0.utf8) },
                usage: usage
            )
            return usage?.total ?? 0
        } catch {
            if sent && Task.isCancelled {
                return chargeCancelledRequest(providerId: providerId, method: method, url: urlString, body: body)
            }
            deliverFailure(requestId: requestId, error: error)
            return 0
        }
    }

    // MARK: - Cross-family translation proxy

    private func proxyWithTranslation(
        requestId: String, originalProviderId: String,
        translation: RoutingTranslation, credential: Credential,
        method: String, urlString sourceUrl: String, headers: [String: String], body: ProxyBody?
    ) async -> Int {
        // Translation works on JSON; binary and form bodies can't be translated.
        if let body, body.asText == nil {
            deliverProxyError(requestId: requestId, code: "TRANSLATION_NOT_SUPPORTED",
                              message: "Cross-family routing does not support binary request bodies.")
            return 0
        }
        let bodyString = body?.asText
        let engine = TranslationEngine.shared
        // Gemini asks for a stream in the URL; the context tells the
        // translator to request one from the destination.
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyString?.data(using: .utf8), url: sourceUrl)
        // Usage is read from the upstream (destination-dialect) bytes. Kept
        // outside `do` so a response cut off midway still counts.
        var meter = UsageMeter(providerId: translation.dstProviderId)
        var upstreamResponse: HTTPURLResponse?
        var destinationUrl: String?
        var sent = false

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
                return 0
            }
            guard let urlString = engine.rewriteProxyUrl(
                dstProviderId: translation.dstProviderId,
                model: translation.dstModel,
                stream: isStreaming,
                overrideBaseUrl: Provider.baseUrlOverride(for: translation.dstProviderId, credentialBaseUrl: credential.baseUrl)
            ) else {
                deliverProxyError(requestId: requestId, code: "TRANSLATION_FAILED", message: "rewriteProxyUrl returned null")
                return 0
            }
            // Check the destination before any key is attached.
            guard let url = Provider.validateUrl(urlString, for: translation.dstProviderId, credentialBaseUrl: credential.baseUrl) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "Destination URL doesn't match the provider")
                return 0
            }
            destinationUrl = urlString

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

            // The app's anthropic-version belongs to the source dialect.
            applyForwardedHeaders(headers, to: &request, excluding: ["anthropic-version"])
            Credential.applyAuth(to: &request, providerId: translation.dstProviderId, authMethod: credential.authMethod, apiKey: dstApiKey)

            sent = true
            let (bytes, response) = try await upstream.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return 0
            }
            upstreamResponse = httpResponse

            deliverResponseHeaders(requestId: requestId, httpResponse: httpResponse)

            // The reply's Content-Type, not the request, decides how it's
            // translated: a destination may answer a stream request with
            // plain JSON, which the stream translator would swallow.
            if !(200..<300).contains(httpResponse.statusCode) {
                await streamRawBytes(requestId: requestId, bytes: bytes, meter: &meter)
            } else if isEventStream(httpResponse) {
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
                        meter.consume(buffer)
                        try rewriteAndTranslate(decoder.decode(buffer))
                        buffer.removeAll(keepingCapacity: true)
                    }
                }
                meter.consume(buffer)
                meter.markComplete()
                try rewriteAndTranslate(decoder.decode(buffer))
                try rewriteAndTranslate(decoder.finish())
                if let tail = toolNameRewriter?.finish() {
                    try translateAndDeliver(tail)
                }
                let trailing = try engine.flushStreamTranslator(handle: streamHandle)
                releasedExplicitly = true
                deliverChunk(requestId, trailing)
            } else {
                // Metered as it downloads, so a reply cut off midway still
                // counts what arrived.
                var accumulated = Data()
                var chunk = Data()
                for try await byte in bytes {
                    chunk.append(byte)
                    if chunk.count >= 65_536 {
                        meter.consume(chunk)
                        accumulated.append(chunk)
                        chunk.removeAll(keepingCapacity: true)
                    }
                }
                meter.consume(chunk)
                accumulated.append(chunk)
                meter.markComplete()
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
        } catch let error as TranslationEngine.EngineError {
            deliverProxyError(requestId: requestId, code: error.pageCode, message: error.pageMessage)
        } catch {
            deliverFailure(requestId: requestId, error: error)
        }

        guard let httpResponse = upstreamResponse else {
            // Cancelled after the request went out, before any response.
            guard sent && Task.isCancelled else { return 0 }
            return chargeCancelledRequest(
                providerId: originalProviderId, method: method, url: destinationUrl ?? sourceUrl, body: body,
                actualProviderId: translation.dstProviderId, actualModel: translation.dstModel
            )
        }
        // Counted even when the stream was cut off or a later step failed:
        // the provider billed it either way.
        meter.finish()
        let usage = UsageParser.settledUsage(
            statusCode: httpResponse.statusCode, meter: meter,
            shouldEstimate: ProxyPolicy.shouldEstimateUsage(
                upstreamProviderId: translation.dstProviderId, appUrl: sourceUrl, contentType: contentType(httpResponse)
            ),
            requestBytes: body?.data.count ?? 0
        )
        wallet.logRequest(
            appOrigin: appOrigin, providerId: originalProviderId,
            method: method, url: destinationUrl ?? sourceUrl,
            statusCode: httpResponse.statusCode,
            requestBody: bodyString?.data(using: .utf8), usage: usage,
            actualProviderId: translation.dstProviderId,
            actualModel: translation.dstModel,
            groupId: wallet.groupForOrigin(appOrigin)?.id
        )
        return usage?.total ?? 0
    }

    // MARK: - Same-family swap proxy

    private func proxyWithSwap(
        requestId: String, originalProviderId: String,
        swapToProviderId: String, swapDstModel: String?,
        credential: Credential,
        method: String, urlString sourceUrl: String, headers: [String: String], body: ProxyBody?
    ) async -> Int {
        let engine = TranslationEngine.shared
        let bodyData = body?.asText.map { Data($0.utf8) }
        let isStreaming = RoutingResolver.isStreamingRequest(body: bodyData, url: sourceUrl)
        let modelForUrl = swapDstModel ?? RoutingResolver.requestedModel(body: bodyData, url: sourceUrl, providerId: originalProviderId) ?? ""
        var sent = false
        var destinationUrl: String?

        do {
            if let message = Provider.missingEndpointMessage(providerId: swapToProviderId, credentialBaseUrl: credential.baseUrl) {
                deliverProxyError(requestId: requestId, code: "ENDPOINT_REQUIRED", message: message)
                return 0
            }
            guard let rewrittenUrlString = engine.rewriteProxyUrl(
                dstProviderId: swapToProviderId, model: modelForUrl, stream: isStreaming,
                overrideBaseUrl: Provider.baseUrlOverride(for: swapToProviderId, credentialBaseUrl: credential.baseUrl)
            ) else {
                deliverProxyError(requestId: requestId, code: "SWAP_FAILED",
                                  message: "rewriteProxyUrl returned null for \(swapToProviderId)")
                return 0
            }
            // Check the destination before any key is attached.
            guard let url = Provider.validateUrl(rewrittenUrlString, for: swapToProviderId, credentialBaseUrl: credential.baseUrl) else {
                deliverProxyError(requestId: requestId, code: "INVALID_URL", message: "Destination URL doesn't match the provider")
                return 0
            }
            destinationUrl = rewrittenUrlString

            // Only JSON bodies are touched (model pin, stream usage); binary
            // and form bodies pass through unchanged.
            var outboundBody = body
            if let text = body?.asText {
                var forwarded: String? = text
                if let dstModel = swapDstModel, !dstModel.isEmpty {
                    forwarded = rewriteModelInJsonBody(forwarded, to: dstModel)
                }
                outboundBody = injectStreamUsageOptions(providerId: swapToProviderId, body: forwarded).map(ProxyBody.text)
            }

            let dstApiKey = try wallet.decryptKey(for: credential)

            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = 120
            request.httpBody = outboundBody?.data

            applyForwardedHeaders(headers, to: &request, body: outboundBody, excluding: ["anthropic-version"])
            Credential.applyAuth(to: &request, providerId: swapToProviderId, authMethod: credential.authMethod, apiKey: dstApiKey)

            sent = true
            let (bytes, response) = try await upstream.bytes(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                deliverProxyError(requestId: requestId, code: "INVALID_RESPONSE", message: "Invalid response")
                return 0
            }

            var meter = UsageMeter(providerId: swapToProviderId)
            await streamResponse(requestId: requestId, httpResponse: httpResponse, bytes: bytes, meter: &meter)

            meter.finish()
            let usage = UsageParser.settledUsage(
                statusCode: httpResponse.statusCode, meter: meter,
                shouldEstimate: ProxyPolicy.shouldEstimateUsage(
                    upstreamProviderId: swapToProviderId, appUrl: sourceUrl, contentType: contentType(httpResponse)
                ),
                requestBytes: body?.data.count ?? 0
            )
            wallet.logRequest(
                appOrigin: appOrigin, providerId: originalProviderId,
                method: method, url: rewrittenUrlString,
                statusCode: httpResponse.statusCode,
                requestBody: bodyData, usage: usage,
                actualProviderId: swapToProviderId,
                actualModel: swapDstModel,
                groupId: wallet.groupForOrigin(appOrigin)?.id
            )
            return usage?.total ?? 0
        } catch {
            if sent && Task.isCancelled {
                return chargeCancelledRequest(
                    providerId: originalProviderId, method: method, url: destinationUrl ?? sourceUrl, body: body,
                    actualProviderId: swapToProviderId, actualModel: swapDstModel
                )
            }
            deliverFailure(requestId: requestId, error: error)
            return 0
        }
    }

    /// The page closed or the wallet locked after the request went out but
    /// before any response arrived. The provider bills it anyway, so charge
    /// the request's estimate (prompt and output limit) and log it as 499,
    /// as the extension does. Returns the tokens to count.
    private func chargeCancelledRequest(
        providerId: String, method: String, url: String, body: ProxyBody?,
        actualProviderId: String? = nil, actualModel: String? = nil
    ) -> Int {
        let usage = UsageParser.requestEstimate(for: body)
        wallet.logRequest(
            appOrigin: appOrigin, providerId: providerId,
            method: method, url: url,
            statusCode: 499,
            requestBody: body?.asText.map { Data($0.utf8) }, usage: usage,
            actualProviderId: actualProviderId,
            actualModel: actualModel,
            groupId: actualProviderId == nil ? nil : wallet.groupForOrigin(appOrigin)?.id
        )
        return usage.total
    }

    /// The app's allowed headers (see `ProxyPolicy.forwardedHeaders`), and a
    /// form body's own Content-Type with its boundary.
    private func applyForwardedHeaders(
        _ headers: [String: String],
        to request: inout URLRequest,
        body: ProxyBody? = nil,
        excluding: Set<String> = []
    ) {
        for (name, value) in ProxyPolicy.forwardedHeaders(headers, excluding: excluding) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let contentType = body?.contentTypeOverride {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
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
        rewriter: ClaudeCodeResponseRewriter? = nil,
        meter: inout UsageMeter
    ) async {
        deliverResponseHeaders(requestId: requestId, httpResponse: httpResponse)
        await streamRawBytes(requestId: requestId, bytes: bytes, rewriter: rewriter, meter: &meter)
        deliver(requestId: requestId, message: [
            "type": "BYOKY_PROXY_RESPONSE_DONE", "requestId": requestId,
        ])
    }

    private func contentType(_ httpResponse: HTTPURLResponse) -> String {
        httpResponse.value(forHTTPHeaderField: "Content-Type") ?? ""
    }

    private func isEventStream(_ httpResponse: HTTPURLResponse) -> Bool {
        contentType(httpResponse).lowercased().contains("text/event-stream")
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

    /// Forward the body to the page as it arrives, feeding `meter` the
    /// upstream bytes on the way.
    private func streamRawBytes(
        requestId: String,
        bytes: URLSession.AsyncBytes,
        rewriter: ClaudeCodeResponseRewriter? = nil,
        meter: inout UsageMeter
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
                    meter.consume(buffer)
                    emit(decoder.decode(buffer))
                    buffer.removeAll(keepingCapacity: true)
                }
            }
            meter.markComplete()
        } catch {}
        meter.consume(buffer)
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

    /// A request that threw. Nothing is sent once the request was cancelled
    /// (page closed, wallet locked).
    private func deliverFailure(requestId: String, error: Error) {
        guard !Task.isCancelled else { return }
        deliverProxyError(requestId: requestId, code: "PROXY_ERROR", message: error.localizedDescription)
    }

    private func deliverProxyError(requestId: String, code: String, message: String) {
        let status: Int = switch code {
        case "SESSION_EXPIRED": 401
        case "NO_CREDENTIAL", "INVALID_URL", "ENDPOINT_REQUIRED", ProxyPolicy.endpointNotAllowedCode: 403
        case "INVALID_BODY", "TRANSLATION_NOT_SUPPORTED", "ROUTING_UNSUPPORTED": 400
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
    "openai", "azure_openai", "together", "deepseek",
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
