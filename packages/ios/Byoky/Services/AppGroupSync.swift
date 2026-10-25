import Foundation

/// The wallet's lock state and provider list, shared with the Safari
/// extension through the App Group's defaults.
final class AppGroupSync {
    static let shared = AppGroupSync()

    private let appGroupId = "group.com.byoky.app"
    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupId)
    }

    private init() {}

    // MARK: - Write State (Main App → Extension)

    func syncWalletState(isUnlocked: Bool, providers: [String]) {
        defaults?.set(isUnlocked, forKey: "walletUnlocked")
        defaults?.set(!providers.isEmpty, forKey: "hasCredentials")
        defaults?.set(providers, forKey: "availableProviders")
    }

    // MARK: - Cleanup

    /// Older builds had the Safari extension queue proxy requests (headers
    /// and bodies) in these defaults for the app to answer. That path is
    /// gone; drop anything it left behind.
    func removeRetiredProxyQueue() {
        guard let defaults else { return }
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix("pendingRequest_") || key.hasPrefix("proxyResponse_") {
            defaults.removeObject(forKey: key)
        }
    }
}
