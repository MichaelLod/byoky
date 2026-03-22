import Foundation

final class AppGroupSync {
    static let shared = AppGroupSync()

    private let appGroupId = "group.com.byoky.app"
    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    private var pollTimer: Timer?
    private var pollCount = 0

    private init() {}

    // MARK: - Write State (Main App → Extension)

    func syncWalletState(isUnlocked: Bool, providers: [String]) {
        defaults?.set(isUnlocked, forKey: "walletUnlocked")
        defaults?.set(!providers.isEmpty, forKey: "hasCredentials")
        defaults?.set(providers, forKey: "availableProviders")
    }

    // MARK: - Proxy Request Polling

    func startPolling(handler: @escaping ([String: Any]) -> Void) {
        stopPolling()
        pollCount = 0
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.checkForPendingRequests(handler: handler)
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func checkForPendingRequests(handler: @escaping ([String: Any]) -> Void) {
        guard let defaults else { return }
        pollCount += 1

        for (key, _) in defaults.dictionaryRepresentation() where key.hasPrefix("pendingRequest_") {
            if let request = defaults.dictionary(forKey: key) {
                defaults.removeObject(forKey: key)
                handler(request)
            }
        }

        if pollCount % 100 == 0 {
            cleanupStaleResponses()
        }
    }

    // MARK: - Write Proxy Response (Main App → Extension)

    func writeProxyResponse(requestId: String, data: Data?, statusCode: Int?, error: String?) {
        var response: [String: Any] = [
            "timestamp": Date().timeIntervalSince1970,
        ]

        if let error {
            response["error"] = error
        } else if let data, let statusCode {
            response["data"] = String(data: data, encoding: .utf8) ?? ""
            response["statusCode"] = statusCode
        }

        defaults?.set(response, forKey: "proxyResponse_\(requestId)")
    }

    // MARK: - Cleanup

    private func cleanupStaleResponses() {
        guard let defaults else { return }
        let staleThreshold = Date().timeIntervalSince1970 - 60
        for (key, _) in defaults.dictionaryRepresentation() where key.hasPrefix("proxyResponse_") {
            if let dict = defaults.dictionary(forKey: key),
               let ts = dict["timestamp"] as? TimeInterval,
               ts < staleThreshold {
                defaults.removeObject(forKey: key)
            }
        }
    }
}
