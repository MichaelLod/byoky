import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet: WalletStore

    init() {
        // Test-only: `-byokyResetOnLaunch 1` wipes all local wallet state
        // *before* the shared WalletStore is first touched. The XCUITest
        // target passes this on launch so each run starts from a clean
        // uninitialized welcome screen regardless of what prior runs left
        // in the keychain. No effect in shipped builds — the launch argument
        // is never set in production.
        if CommandLine.arguments.contains("-byokyResetOnLaunch") {
            // Touching the shared instance triggers its private init, which
            // reads the keychain. resetWallet() then wipes it. Status will be
            // .uninitialized on the next UI tick.
            WalletStore.shared.resetWallet()
        }
        _wallet = StateObject(wrappedValue: WalletStore.shared)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(wallet)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
        }
    }

    private func handleIncomingURL(_ url: URL) {
        guard url.scheme == "byoky" else { return }
        // byoky://gift/<encoded> — host is "gift", path holds the payload.
        // Absolute fallback: stash the whole URL string so RedeemGiftView's
        // existing parser can strip the prefix.
        if url.host == "gift" {
            wallet.pendingGiftLink = url.absoluteString
        }
    }
}
