import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            WalletView()
                .tabItem {
                    Label("Wallet", systemImage: "wallet.bifold")
                }

            PairView()
                .tabItem {
                    Label("Pair", systemImage: "qrcode.viewfinder")
                }

            BridgeView()
                .tabItem {
                    Label("Bridge", systemImage: "antenna.radiowaves.left.and.right")
                }

            UsageView()
                .tabItem {
                    Label("Usage", systemImage: "chart.bar")
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
