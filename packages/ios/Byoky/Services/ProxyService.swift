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

    private enum CredentialSource {
        case own(Credential, String)
        case gift(GiftedCredential)
    }

    private func resolveCredentialSource(providerId: String) async throws -> CredentialSource {
        let prefs = await MainActor.run { wallet.giftPreferences }
        let giftedCreds = await MainActor.run { wallet.giftedCredentials }
        let ownCred = await MainActor.run { wallet.credentials.first { $0.providerId == providerId } }

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

    var errorDescription: String? {
        switch self {
        case .unknownProvider(let id): return "Unknown provider: \(id)"
        case .noCredential(let id): return "No credential for provider: \(id)"
        case .invalidResponse: return "Invalid response from API"
        case .serverStartFailed: return "Failed to start proxy server"
        case .invalidUrl(let url): return "Invalid or disallowed URL: \(url)"
        }
    }
}
