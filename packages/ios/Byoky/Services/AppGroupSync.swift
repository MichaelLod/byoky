import Foundation

/// Syncs wallet state to the App Group shared container
/// so the Safari extension can read it.
final class AppGroupSync {
    static let shared = AppGroupSync()

    private let appGroupId = "group.com.byoky.app"
    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    private var pollTimer: Timer?

    private init() {}

    // MARK: - Write State (Main App → Extension)

    func syncWalletState(isUnlocked: Bool, providers: [String]) {
        defaults?.set(isUnlocked, forKey: "walletUnlocked")
        defaults?.set(!providers.isEmpty, forKey: "hasCredentials")
        defaults?.set(providers, forKey: "availableProviders")
    }

    // MARK: - Proxy Request Polling

    /// Start polling for proxy requests from the Safari extension.
    /// The extension writes requests to the shared container,
    /// and we process them here and write back responses.
    func startPolling(handler: @escaping ([String: Any]) -> Void) {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.checkForPendingRequest(handler: handler)
        }
    }

    func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func checkForPendingRequest(handler: @escaping ([String: Any]) -> Void) {
        guard let request = defaults?.dictionary(forKey: "pendingProxyRequest") else { return }

        // Clear the pending request immediately
        defaults?.removeObject(forKey: "pendingProxyRequest")

        handler(request)
    }

    // MARK: - Write Proxy Response (Main App → Extension)

    func writeProxyResponse(requestId: String, data: Data?, statusCode: Int?, error: String?) {
        var response: [String: Any] = [:]

        if let error {
            response["error"] = error
        } else if let data, let statusCode {
            response["data"] = String(data: data, encoding: .utf8) ?? ""
            response["statusCode"] = statusCode
        }

        defaults?.set(response, forKey: "proxyResponse_\(requestId)")
    }
}
