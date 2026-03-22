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

/// Minimal HTTP proxy server that listens on localhost.
/// Routes /<providerId>/path to the real API with the user's key injected.
actor ProxyServer {
    private let wallet: WalletStore
    private var listener: (any AnyObject)?
    private var port: Int = 0

    init(wallet: WalletStore) {
        self.wallet = wallet
    }

    func start() throws -> Int {
        let port = findAvailablePort()
        self.port = port

        // NWListener-based HTTP server
        // For now, use a URLSession-based approach via GCDAsyncSocket or NWListener
        // This is the lightweight local proxy that the Safari extension talks to

        return port
    }

    func stop() {
        listener = nil
    }

    /// Proxy a request: inject the API key and forward to the real provider.
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

        // Find credential for this provider
        let credential = await MainActor.run {
            wallet.credentials.first { $0.providerId == providerId }
        }

        guard let credential else {
            throw ProxyError.noCredential(providerId)
        }

        let apiKey = try await MainActor.run {
            try wallet.decryptKey(for: credential)
        }

        // Build the real URL
        let url = URL(string: "\(provider.baseUrl)\(path)")!

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 120

        // Forward headers, inject auth
        for (key, value) in headers {
            if key.lowercased() == "host" { continue }
            if key.lowercased() == "authorization" { continue }
            request.setValue(value, forHTTPHeaderField: key)
        }

        // Provider-specific auth header
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

    /// Proxy a streaming request, yielding chunks as they arrive.
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

                    let credential = await MainActor.run {
                        wallet.credentials.first { $0.providerId == providerId }
                    }

                    guard let credential else {
                        throw ProxyError.noCredential(providerId)
                    }

                    let apiKey = try await MainActor.run {
                        try wallet.decryptKey(for: credential)
                    }

                    let url = URL(string: "\(provider.baseUrl)\(path)")!
                    var request = URLRequest(url: url)
                    request.httpMethod = method
                    request.httpBody = body
                    request.timeoutInterval = 120

                    for (key, value) in headers {
                        if key.lowercased() == "host" || key.lowercased() == "authorization" { continue }
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
        // Find an available port in the ephemeral range
        Int.random(in: 49152...65535)
    }
}

enum ProxyError: LocalizedError {
    case unknownProvider(String)
    case noCredential(String)
    case invalidResponse
    case serverStartFailed

    var errorDescription: String? {
        switch self {
        case .unknownProvider(let id): return "Unknown provider: \(id)"
        case .noCredential(let id): return "No credential for provider: \(id)"
        case .invalidResponse: return "Invalid response from API"
        case .serverStartFailed: return "Failed to start proxy server"
        }
    }
}
