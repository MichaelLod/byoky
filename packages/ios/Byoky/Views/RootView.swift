import SwiftUI

struct RootView: View {
    @EnvironmentObject var wallet: WalletStore

    var body: some View {
        Group {
            switch wallet.status {
            case .uninitialized:
                OnboardingView()
            case .locked:
                UnlockView()
            case .unlocked:
                MainTabView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: wallet.status == .unlocked)
    }
}
