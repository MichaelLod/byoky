import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet = WalletStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(wallet)
                .preferredColorScheme(.dark)
        }
    }
}
