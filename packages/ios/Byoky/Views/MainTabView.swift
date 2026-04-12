import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            WalletView()
                .tabItem {
                    Label("Wallet", systemImage: "wallet.bifold")
                }
                .accessibilityIdentifier("tab.wallet")

            GiftsView()
                .tabItem {
                    Label("Gifts", systemImage: "gift")
                }
                .accessibilityIdentifier("tab.gifts")

            ConnectView()
                .tabItem {
                    Label("Connect", systemImage: "antenna.radiowaves.left.and.right")
                }
                .accessibilityIdentifier("tab.connect")

            UsageView()
                .tabItem {
                    Label("Usage", systemImage: "chart.bar")
                }
                .accessibilityIdentifier("tab.usage")

            MarketplaceTabView()
                .tabItem {
                    Label("Apps", systemImage: "square.grid.2x2")
                }
                .accessibilityIdentifier("tab.apps")
        }
        .tint(Theme.accent)
    }
}
