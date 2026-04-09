import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            WalletView()
                .tabItem {
                    Label("Wallet", systemImage: "wallet.bifold")
                }

            GiftsView()
                .tabItem {
                    Label("Gifts", systemImage: "gift")
                }

            ConnectView()
                .tabItem {
                    Label("Connect", systemImage: "antenna.radiowaves.left.and.right")
                }

            UsageView()
                .tabItem {
                    Label("Usage", systemImage: "chart.bar")
                }

            AppsView()
                .tabItem {
                    Label("Apps", systemImage: "square.stack.3d.up")
                }
        }
        .tint(Theme.accent)
    }
}
