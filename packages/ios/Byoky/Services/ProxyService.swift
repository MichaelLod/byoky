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

        let credential = await MainActor.run {
            wallet.credentials.first { $0.providerId == providerId }
        }

        guard let credential else {
            throw ProxyError.noCredential(providerId)
        }

        let apiKey = try await MainActor.run {
            try wallet.decryptKey(for: credential)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 120

        for (key, value) in headers {
            let lower = key.lowercased()
            if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
            request.setValue(value, forHTTPHeaderField: key)
        }

        switch providerId {
        case "anthropic":
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        default:
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ProxyError.invalidResponse
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

                    let credential = await MainActor.run {
                        wallet.credentials.first { $0.providerId == providerId }
                    }

                    guard let credential else {
                        throw ProxyError.noCredential(providerId)
                    }

                    let apiKey = try await MainActor.run {
                        try wallet.decryptKey(for: credential)
                    }

                    var request = URLRequest(url: url)
                    request.httpMethod = method
                    request.httpBody = body
                    request.timeoutInterval = 120

                    for (key, value) in headers {
                        let lower = key.lowercased()
                        if lower == "host" || lower == "authorization" || lower == "x-api-key" { continue }
                        request.setValue(value, forHTTPHeaderField: key)
                    }

                    switch providerId {
                    case "anthropic":
                        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
                    default:
                        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
                    }

                    let (bytes, _) = try await URLSession.shared.bytes(for: request)

                    for try await byte in bytes {
                        continuation.yield(Data([byte]))
                    }

                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
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
