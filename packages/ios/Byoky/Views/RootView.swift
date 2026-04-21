import SwiftUI

struct RootView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        SwiftUI.Group {
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
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                wallet.recordBackgroundTime()
                // iOS suspends URLSessionWebSocketTask in the background, so
                // drop every gift relay socket explicitly. They'll be reopened
                // when we return to .active.
                GiftRelayHost.shared.disconnectAll()
            case .active:
                wallet.checkAutoLock()
                if wallet.status == .unlocked {
                    GiftRelayHost.shared.reconnectAll()
                    Task { await wallet.reconcileGiftUsageWithVault() }
                }
            default:
                break
            }
        }
    }
}
