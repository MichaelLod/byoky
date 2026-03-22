import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            WalletView()
                .tabItem {
                    Label("Wallet", systemImage: "wallet.bifold")
                }

            BridgeView()
                .tabItem {
                    Label("Bridge", systemImage: "antenna.radiowaves.left.and.right")
                }

            SessionsView()
                .tabItem {
                    Label("Sessions", systemImage: "link")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .tint(Theme.accent)
    }
}
