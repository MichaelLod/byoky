import SwiftUI

struct RootView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.scenePhase) private var scenePhase
    /// Fires every 4 min while the app is in the foreground so the
    /// marketplace "online" badge stays fresh. The vault covers the
    /// backgrounded case.
    private let marketplaceHeartbeatTimer = Timer.publish(every: 240, on: .main, in: .common).autoconnect()

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
                    Task { await wallet.heartbeatMarketplace() }
                }
            default:
                break
            }
        }
        .onReceive(marketplaceHeartbeatTimer) { _ in
            if wallet.status == .unlocked {
                Task { await wallet.heartbeatMarketplace() }
            }
        }
    }
}
