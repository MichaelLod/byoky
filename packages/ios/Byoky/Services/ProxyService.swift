import Foundation

actor ProxyService {
    static let shared = ProxyService()

    private var server: ProxyServer?

    func start(wallet: WalletStore) async throws -> Int {
        let server = ProxyServer(wallet: wallet)
        let port = try await server.start()
        self.server = server
        return port
    }

    func stop() async {
        await server?.stop()
        server = nil
    }

    var isRunning: Bool {
        server != nil
    }

    func checkAvailable() async -> Bool {
        guard let server else { return false }
        return await server.checkAvailable()
    }
}

actor ProxyServer {
    private let wallet: WalletStore
    private var listener: (any AnyObject)?
    private var port: Int = 0

    init(wallet: WalletStore) {
        self.wallet = wallet
    }

    func start() throws -> Int {
        let port = findAvailablePort()
        guard port > 0 else {
            throw ProxyError.serverStartFailed
        }
        self.port = port
        return port
    }

    func stop() {
        listener = nil
    }

    func proxyRequest(
        providerId: String,
        path: String,
        method: String,
        headers: [String: String],
        body: Data?
    ) async throws -> (Data, HTTPURLResponse) {
        guard let provider = Provider.find(providerId) else {
            throw ProxyError.unknownProvider(providerId)
        }

        guard let url = Provider.buildUrl(provider: provider, path: path) else {
            throw ProxyError.invalidUrl(path)
        }

        let source = try await resolveCredentialSource(providerId: providerId)
        if case .gift(let gc) = source {
            return try await proxyRequestViaGift(gc: gc, url: url, providerId: providerId, method: method, headers: headers, body: body)
        }
        guard case .own(let credential, let apiKey) = source else {
            throw ProxyError.noCredential(providerId)
        }

        // Routing resolution. Mobile's local TCP proxy currently lacks a
        // per-app origin tag (a single TCP listener serves every caller), so
        // we resolve against the "bridge" origin → default group. The relay
        // path (RelayPairService) carries the real paired origin and uses
        // it for per-app routing; this branch will gain the same once the
        // local proxy adds a pairing handshake. Three outcomes mirror the
        // relay flow:
        //   1. Cross-family translation (group binds a different family)
        //   2. Same-family swap (group binds a different provider in the
        //      same family — different credential, identical wire format)
        //   3. Pass-through (no group, no model, or no usable rule)
        if let routing = await resolveRouting(requestedProviderId: providerId, body: body) {
            if let translation = routing.translation {
                return try await proxyRequestWithTranslation(
                    originalProviderId: providerId,
                    translation: translation,
                    routedCredential: routing.credential,
                    method: method,
                    headers: headers,
                    body: body
                )
            }
            if let swapTo = routing.swapToProviderId {
                return try await proxyRequestWithSwap(
                    originalProviderId: providerId,
                    swapToProviderId: swapTo,
                    swapDstModel: routing.swapDstModel,
                    routedCredential: routing.credential,
                    method: method,
                    headers: headers,
                    body: body
                )
            }
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = injectStreamUsageOptions(providerId: providerId, body: body)
        request.timeoutInterval = 120

        for (key, value) in headers {
            let lower = key.lowercased()
            if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
            request.setValue(value, forHTTPHeaderField: key)
        }

        Credential.applyAuth(to: &request, providerId: providerId, authMethod: credential.authMethod, apiKey: apiKey)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ProxyError.invalidResponse
        }

        let responseBody = String(data: data, encoding: .utf8)
        await MainActor.run {
            wallet.logRequest(
                appOrigin: "bridge",
                providerId: providerId,
                method: method,
                url: url.absoluteString,
                statusCode: httpResponse.statusCode,
                requestBody: body,
                responseBody: responseBody
            )
        }

        return (data, httpResponse)
    }

    /// Resolve cross-family routing. Returns nil for pass-through cases (no
    /// group / same family / no model / no credential). Caller pre-resolved
    /// the credential source as `.own` — gifts skip routing entirely.
    private func resolveRouting(requestedProviderId: String, body: Data?) async -> RoutingDecision? {
        let group = await MainActor.run { wallet.groupForOrigin("bridge") }
        let allCreds = await MainActor.run { wallet.credentials }
        let srcModel = RoutingResolver.parseModel(from: body)
        return RoutingResolver.resolve(
            requestedProviderId: requestedProviderId,
            requestedModel: srcModel,
            group: group,
            credentials: allCreds
        )
    }

    /// Cross-family translation path for non-streaming requests. Translates
    /// the request body src→dst, sends to the destination provider, and
    /// translates the response dst→src so the SDK sees its native dialect.
    private func proxyRequestWithTranslation(
        originalProviderId: String,
        translation: RoutingTranslation,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        body: Data?
    ) async throws -> (Data, HTTPURLResponse) {
        let engine = TranslationEngine.shared
        let requestId = UUID().uuidString

        // Build context + translate request body via the JS bridge.
        let bodyString = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let ctxJson: String
        let translatedBodyString: String
        do {
            ctxJson = try engine.buildTranslationContext(
                srcProviderId: translation.srcProviderId,
                dstProviderId: translation.dstProviderId,
                srcModel: translation.srcModel,
                dstModel: translation.dstModel,
                isStreaming: false,
                requestId: requestId
            )
            translatedBodyString = try engine.translateRequest(contextJson: ctxJson, body: bodyString)
        } catch {
            throw ProxyError.translationFailed(error.localizedDescription)
        }

        // Rewrite the upstream URL to the destination provider's chat endpoint.
        guard let urlString = engine.rewriteProxyUrl(
            dstProviderId: translation.dstProviderId,
            model: translation.dstModel,
            stream: false
        ), let url = URL(string: urlString) else {
            throw ProxyError.invalidUrl(translation.dstProviderId)
        }

        // Decrypt the destination credential's key.
        let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

        // Build URLRequest with the translated body and destination auth.
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = injectStreamUsageOptions(
            providerId: translation.dstProviderId,
            body: Data(translatedBodyString.utf8)
        )
        request.timeoutInterval = 120

        for (key, value) in headers {
            let lower = key.lowercased()
            // Strip auth + the source provider's anthropic-version header (it's
            // meaningless to other families). Drop content-length so URLSession
            // computes it for the (possibly resized) translated body.
            if ["host", "authorization", "x-api-key", "anthropic-version", "content-length"].contains(lower) { continue }
            request.setValue(value, forHTTPHeaderField: key)
        }

        Credential.applyAuth(
            to: &request,
            providerId: translation.dstProviderId,
            authMethod: routedCredential.authMethod,
            apiKey: dstApiKey
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ProxyError.invalidResponse
        }

        // Translate response body dst → src so the app sees its dialect.
        let upstreamBody = String(data: data, encoding: .utf8) ?? ""
        let translatedResponseString: String
        if (200..<300).contains(httpResponse.statusCode) {
            do {
                translatedResponseString = try engine.translateResponse(contextJson: ctxJson, body: upstreamBody)
            } catch {
                throw ProxyError.translationFailed(error.localizedDescription)
            }
        } else {
            // Don't try to translate error bodies — they're rarely in the
            // shape the source dialect expects. Pass the upstream error
            // through verbatim. The SDK will see a non-2xx response with
            // whatever the destination provider sent.
            translatedResponseString = upstreamBody
        }
        let translatedData = Data(translatedResponseString.utf8)

        await MainActor.run {
            wallet.logRequest(
                appOrigin: "bridge",
                providerId: originalProviderId,
                method: method,
                url: url.absoluteString,
                statusCode: httpResponse.statusCode,
                requestBody: body,
                responseBody: translatedResponseString,
                actualProviderId: translation.dstProviderId,
                actualModel: translation.dstModel,
                groupId: defaultGroupId
            )
        }

        return (translatedData, httpResponse)
    }

    func proxyStreamingRequest(
        providerId: String,
        path: String,
        method: String,
        headers: [String: String],
        body: Data?
    ) -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    guard let provider = Provider.find(providerId) else {
                        throw ProxyError.unknownProvider(providerId)
                    }

                    guard let url = Provider.buildUrl(provider: provider, path: path) else {
                        throw ProxyError.invalidUrl(path)
                    }

                    let source = try await self.resolveCredentialSource(providerId: providerId)

                    if case .gift(let gc) = source {
                        let filteredHeaders = headers.filter {
                            !["host", "authorization", "x-api-key"].contains($0.key.lowercased())
                        }
                        for try await event in proxyViaGiftRelay(
                            giftedCredential: gc,
                            requestId: UUID().uuidString,
                            providerId: providerId,
                            url: url.absoluteString,
                            method: method,
                            headers: filteredHeaders,
                            body: body.flatMap { String(data: $0, encoding: .utf8) }
                        ) {
                            switch event {
                            case .chunk(let chunk):
                                if let data = chunk.data(using: .utf8) {
                                    continuation.yield(data)
                                }
                            case .usage(let giftId, let usedTokens):
                                await MainActor.run {
                                    self.wallet.updateGiftedCredentialUsage(giftId: giftId, usedTokens: usedTokens)
                                }
                            default:
                                break
                            }
                        }
                        continuation.finish()
                        return
                    }

                    guard case .own(let credential, let apiKey) = source else {
                        throw ProxyError.noCredential(providerId)
                    }

                    // Routing resolution (mirrors the non-streaming path).
                    // Three outcomes: cross-family translation, same-family
                    // swap, or fall through to pass-through.
                    if let routing = await self.resolveRouting(requestedProviderId: providerId, body: body) {
                        if let translation = routing.translation {
                            try await self.streamWithTranslation(
                                originalProviderId: providerId,
                                translation: translation,
                                routedCredential: routing.credential,
                                method: method,
                                headers: headers,
                                body: body,
                                continuation: continuation
                            )
                            return
                        }
                        if let swapTo = routing.swapToProviderId {
                            try await self.streamWithSwap(
                                originalProviderId: providerId,
                                swapToProviderId: swapTo,
                                swapDstModel: routing.swapDstModel,
                                routedCredential: routing.credential,
                                method: method,
                                headers: headers,
                                body: body,
                                continuation: continuation
                            )
                            return
                        }
                    }

                    var request = URLRequest(url: url)
                    request.httpMethod = method
                    request.httpBody = injectStreamUsageOptions(providerId: providerId, body: body)
                    request.timeoutInterval = 120

                    for (key, value) in headers {
                        let lower = key.lowercased()
                        if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
                        request.setValue(value, forHTTPHeaderField: key)
                    }

                    Credential.applyAuth(to: &request, providerId: providerId, authMethod: credential.authMethod, apiKey: apiKey)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let httpResponse = response as? HTTPURLResponse
                    var accumulated = Data()

                    for try await byte in bytes {
                        let chunk = Data([byte])
                        accumulated.append(byte)
                        continuation.yield(chunk)
                    }

                    let responseBody = String(data: accumulated, encoding: .utf8)
                    let statusCode = httpResponse?.statusCode ?? 0
                    await MainActor.run {
                        self.wallet.logRequest(
                            appOrigin: "bridge",
                            providerId: providerId,
                            method: method,
                            url: url.absoluteString,
                            statusCode: statusCode,
                            requestBody: body,
                            responseBody: responseBody
                        )
                    }

                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    /// Cross-family streaming path. Reads upstream SSE line-by-line (so chunks
    /// never split mid-UTF-8-character), passes each line through the JS
    /// stream translator, and yields the translated bytes back to the SDK.
    /// Logs once at end with translation metadata.
    private func streamWithTranslation(
        originalProviderId: String,
        translation: RoutingTranslation,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        body: Data?,
        continuation: AsyncThrowingStream<Data, Error>.Continuation
    ) async throws {
        let engine = TranslationEngine.shared
        let requestId = UUID().uuidString

        // Build context + translate request body.
        let bodyString = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        let ctxJson: String
        let translatedBodyString: String
        do {
            ctxJson = try engine.buildTranslationContext(
                srcProviderId: translation.srcProviderId,
                dstProviderId: translation.dstProviderId,
                srcModel: translation.srcModel,
                dstModel: translation.dstModel,
                isStreaming: true,
                requestId: requestId
            )
            translatedBodyString = try engine.translateRequest(contextJson: ctxJson, body: bodyString)
        } catch {
            throw ProxyError.translationFailed(error.localizedDescription)
        }

        guard let urlString = engine.rewriteProxyUrl(
            dstProviderId: translation.dstProviderId,
            model: translation.dstModel,
            stream: true
        ), let url = URL(string: urlString) else {
            throw ProxyError.invalidUrl(translation.dstProviderId)
        }

        let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = injectStreamUsageOptions(
            providerId: translation.dstProviderId,
            body: Data(translatedBodyString.utf8)
        )
        request.timeoutInterval = 120
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

        // Open the stream translator handle. Make sure we always release it,
        // even on early throw, to avoid leaking the JS-side entry forever.
        let streamHandle = try engine.createStreamTranslator(contextJson: ctxJson)
        var releasedExplicitly = false
        defer {
            if !releasedExplicitly {
                engine.releaseStreamTranslator(handle: streamHandle)
            }
        }

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        let httpResponse = response as? HTTPURLResponse
        let statusCode = httpResponse?.statusCode ?? 0

        // For non-2xx upstream errors, don't try to translate the body —
        // pass the raw bytes through (they're rarely in source dialect shape).
        if !(200..<300).contains(statusCode) {
            for try await byte in bytes {
                continuation.yield(Data([byte]))
            }
            await MainActor.run {
                wallet.logRequest(
                    appOrigin: "bridge",
                    providerId: originalProviderId,
                    method: method,
                    url: url.absoluteString,
                    statusCode: statusCode,
                    requestBody: body,
                    responseBody: nil,
                    actualProviderId: translation.dstProviderId,
                    actualModel: translation.dstModel,
                    groupId: defaultGroupId
                )
            }
            continuation.finish()
            return
        }

        // 2xx path: stream lines through the translator. Lines are character-
        // safe (URLSession.bytes.lines decodes UTF-8 properly) so we never
        // hand the bridge a partial multi-byte sequence.
        do {
            for try await line in bytes.lines {
                // .lines strips the newline; the translator's parser
                // re-segments on whatever delimiters its source dialect uses,
                // so it's fine to feed line-by-line. Re-add `\n` to keep the
                // SSE framing intact for parsers that look for newlines.
                let chunk = line + "\n"
                let translated = try engine.processStreamChunk(handle: streamHandle, chunk: chunk)
                if !translated.isEmpty {
                    continuation.yield(Data(translated.utf8))
                }
            }
            // Flush any buffered output and release the handle in one call.
            let trailing = try engine.flushStreamTranslator(handle: streamHandle)
            releasedExplicitly = true
            if !trailing.isEmpty {
                continuation.yield(Data(trailing.utf8))
            }
        } catch {
            // The defer block releases the handle.
            throw ProxyError.translationFailed("\(error.localizedDescription)")
        }

        await MainActor.run {
            wallet.logRequest(
                appOrigin: "bridge",
                providerId: originalProviderId,
                method: method,
                url: url.absoluteString,
                statusCode: statusCode,
                requestBody: body,
                responseBody: nil, // streaming bodies aren't accumulated for usage parsing here
                actualProviderId: translation.dstProviderId,
                actualModel: translation.dstModel,
                groupId: defaultGroupId
            )
        }

        continuation.finish()
    }

    /// Same-family swap path for non-streaming requests. Two providers in
    /// the same family (e.g. Groq → OpenAI) speak identical wire formats,
    /// so we skip the JS translation bridge entirely and just rewrite the
    /// URL, swap the credential, and (optionally) override the body's
    /// `model` field. Mirrors `RelayPairService.handleRelayRequestWithSwap`.
    private func proxyRequestWithSwap(
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        body: Data?
    ) async throws -> (Data, HTTPURLResponse) {
        let engine = TranslationEngine.shared
        let isStreaming = RoutingResolver.isStreamingRequest(body: body)
        // Use the group's pinned destination model for URL building when set,
        // otherwise fall back to whatever the SDK sent. Most openai-family
        // providers ignore the model in the URL (it comes from the body),
        // but rewriteProxyUrl needs a non-empty value to build a URL.
        let modelForUrl = swapDstModel ?? RoutingResolver.parseModel(from: body) ?? ""

        guard let urlString = engine.rewriteProxyUrl(
            dstProviderId: swapToProviderId,
            model: modelForUrl,
            stream: isStreaming
        ), let url = URL(string: urlString) else {
            throw ProxyError.invalidUrl(swapToProviderId)
        }

        // Substitute the body's `model` field with the group's pinned dst
        // model when set. Same-family providers all accept a JSON body with
        // a top-level `model` string, so a surgical edit is safe and minimal.
        let bodyString = body.flatMap { String(data: $0, encoding: .utf8) }
        let forwardedString: String? = swapDstModel.flatMap { dst in
            dst.isEmpty ? bodyString : Self.rewriteModelInJsonBody(bodyString, to: dst)
        } ?? bodyString
        let injectedString = injectStreamUsageOptions(providerId: swapToProviderId, body: forwardedString) ?? forwardedString
        let forwardedBody = injectedString.flatMap { $0.data(using: .utf8) }

        let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = forwardedBody
        request.timeoutInterval = 120
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

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ProxyError.invalidResponse
        }

        // Forward the response body verbatim — wire formats are identical
        // on both sides of a same-family swap.
        let responseBody = String(data: data, encoding: .utf8)
        await MainActor.run {
            wallet.logRequest(
                appOrigin: "bridge",
                providerId: originalProviderId,
                method: method,
                url: url.absoluteString,
                statusCode: httpResponse.statusCode,
                requestBody: body,
                responseBody: responseBody,
                actualProviderId: swapToProviderId,
                actualModel: swapDstModel,
                groupId: defaultGroupId
            )
        }

        return (data, httpResponse)
    }

    /// Same-family swap path for streaming requests. Mirrors the non-streaming
    /// version above but pipes upstream bytes straight through to the SDK —
    /// no translation, just verbatim forwarding under the destination
    /// provider's credential.
    private func streamWithSwap(
        originalProviderId: String,
        swapToProviderId: String,
        swapDstModel: String?,
        routedCredential: Credential,
        method: String,
        headers: [String: String],
        body: Data?,
        continuation: AsyncThrowingStream<Data, Error>.Continuation
    ) async throws {
        let engine = TranslationEngine.shared
        let modelForUrl = swapDstModel ?? RoutingResolver.parseModel(from: body) ?? ""

        guard let urlString = engine.rewriteProxyUrl(
            dstProviderId: swapToProviderId,
            model: modelForUrl,
            stream: true
        ), let url = URL(string: urlString) else {
            throw ProxyError.invalidUrl(swapToProviderId)
        }

        let bodyString = body.flatMap { String(data: $0, encoding: .utf8) }
        let forwardedString: String? = swapDstModel.flatMap { dst in
            dst.isEmpty ? bodyString : Self.rewriteModelInJsonBody(bodyString, to: dst)
        } ?? bodyString
        let injectedString = injectStreamUsageOptions(providerId: swapToProviderId, body: forwardedString) ?? forwardedString
        let forwardedBody = injectedString.flatMap { $0.data(using: .utf8) }

        let dstApiKey = try await MainActor.run { try wallet.decryptKey(for: routedCredential) }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = forwardedBody
        request.timeoutInterval = 120
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
        let httpResponse = response as? HTTPURLResponse
        let statusCode = httpResponse?.statusCode ?? 0

        for try await byte in bytes {
            continuation.yield(Data([byte]))
        }

        await MainActor.run {
            wallet.logRequest(
                appOrigin: "bridge",
                providerId: originalProviderId,
                method: method,
                url: url.absoluteString,
                statusCode: statusCode,
                requestBody: body,
                responseBody: nil,
                actualProviderId: swapToProviderId,
                actualModel: swapDstModel,
                groupId: defaultGroupId
            )
        }
        continuation.finish()
    }

    /// Surgically rewrite the top-level `model` field of a JSON request body
    /// to `newModel`. Returns the original body unchanged if parsing fails —
    /// we'd rather pass through and let the destination return a real error
    /// than silently corrupt the request. Used by the same-family swap path
    /// when the group pins a destination model.
    private static func rewriteModelInJsonBody(_ body: String?, to newModel: String) -> String? {
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

    private enum CredentialSource {
        case own(Credential, String)
        case gift(GiftedCredential)
    }

    private func resolveCredentialSource(providerId: String) async throws -> CredentialSource {
        let prefs = await MainActor.run { wallet.giftPreferences }
        let giftedCreds = await MainActor.run { wallet.giftedCredentials }
        let ownCred = await MainActor.run { wallet.credentials.first { $0.providerId == providerId } }
        let group = await MainActor.run { wallet.groupForOrigin("bridge") }

        // A group pinned to a specific gift for this provider wins over every
        // other source — owned creds, preferences, unpinned gifts. The gift's
        // own relay carries the request. Falls through if the pinned gift is
        // expired, exhausted, or gone.
        if let group, group.providerId == providerId, let pinnedGiftId = group.giftId,
           let gc = giftedCreds.first(where: {
               $0.giftId == pinnedGiftId
               && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
           }) {
            return .gift(gc)
        }

        if let preferredGiftId = prefs[providerId],
           let gc = giftedCreds.first(where: {
               $0.giftId == preferredGiftId && $0.providerId == providerId
               && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
           }) {
            return .gift(gc)
        }

        if let cred = ownCred {
            let apiKey = try await MainActor.run { try wallet.decryptKey(for: cred) }
            return .own(cred, apiKey)
        }

        if let gc = giftedCreds.first(where: {
            $0.providerId == providerId && !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens
        }) {
            return .gift(gc)
        }

        throw ProxyError.noCredential(providerId)
    }

    private func proxyRequestViaGift(
        gc: GiftedCredential,
        url: URL,
        providerId: String,
        method: String,
        headers: [String: String],
        body: Data?
    ) async throws -> (Data, HTTPURLResponse) {
        let bodyStr = body.flatMap { String(data: $0, encoding: .utf8) }
        let requestId = UUID().uuidString
        let filteredHeaders = headers.filter {
            !["host", "authorization", "x-api-key"].contains($0.key.lowercased())
        }

        var responseData = Data()
        var responseStatus = 0
        var responseHeaders: [String: String] = [:]

        for try await event in proxyViaGiftRelay(
            giftedCredential: gc,
            requestId: requestId,
            providerId: providerId,
            url: url.absoluteString,
            method: method,
            headers: filteredHeaders,
            body: bodyStr
        ) {
            switch event {
            case .meta(let status, _, let hdrs):
                responseStatus = status
                responseHeaders = hdrs
            case .chunk(let chunk):
                if let data = chunk.data(using: .utf8) {
                    responseData.append(data)
                }
            case .usage(let giftId, let usedTokens):
                await MainActor.run { wallet.updateGiftedCredentialUsage(giftId: giftId, usedTokens: usedTokens) }
            case .done:
                break
            }
        }

        guard let httpResponse = HTTPURLResponse(
            url: url,
            statusCode: responseStatus,
            httpVersion: "HTTP/1.1",
            headerFields: responseHeaders
        ) else {
            throw ProxyError.invalidResponse
        }

        await MainActor.run {
            wallet.logRequest(
                appOrigin: "gift",
                providerId: providerId,
                method: method,
                url: url.absoluteString,
                statusCode: responseStatus,
                requestBody: body,
                responseBody: String(data: responseData, encoding: .utf8)
            )
        }

        return (responseData, httpResponse)
    }

    func checkAvailable() async -> Bool {
        guard port > 0 else { return false }
        let hasCreds = await MainActor.run {
            !wallet.credentials.isEmpty || !wallet.giftedCredentials.isEmpty
        }
        return hasCreds
    }

    private func findAvailablePort() -> Int {
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { return 0 }
        defer { close(fd) }

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")

        let bindResult = withUnsafeMutablePointer(to: &addr) { addrPtr in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { return 0 }

        var boundAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &boundAddr) { addrPtr in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                getsockname(fd, sockPtr, &addrLen)
            }
        }

        return Int(UInt16(bigEndian: boundAddr.sin_port))
    }
}

enum ProxyError: LocalizedError {
    case unknownProvider(String)
    case noCredential(String)
    case invalidResponse
    case serverStartFailed
    case invalidUrl(String)
    case translationFailed(String)

    var errorDescription: String? {
        switch self {
        case .unknownProvider(let id): return "Unknown provider: \(id)"
        case .noCredential(let id): return "No credential for provider: \(id)"
        case .invalidResponse: return "Invalid response from API"
        case .serverStartFailed: return "Failed to start proxy server"
        case .invalidUrl(let url): return "Invalid or disallowed URL: \(url)"
        case .translationFailed(let msg): return "Translation failed: \(msg)"
        }
    }
}
