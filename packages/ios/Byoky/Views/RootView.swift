import SwiftUI

struct RootView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.scenePhase) private var scenePhase

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
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                wallet.recordBackgroundTime()
            case .active:
                wallet.checkAutoLock()
            default:
                break
            }
        }
    }
}
