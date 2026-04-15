import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var selectedTab: Int = 0
    @State private var showAddCredential = false
    @State private var showRedeemGift = false
    @State private var showAppStore = false

    private static let appsTabIndex = 2

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            TabView(selection: $selectedTab) {
                WalletView()
                    .tabItem {
                        Label("Wallet", systemImage: "wallet.bifold")
                    }
                    .accessibilityIdentifier("tab.wallet")
                    .tag(0)

                GiftsView()
                    .tabItem {
                        Label("Gifts", systemImage: "gift")
                    }
                    .accessibilityIdentifier("tab.gifts")
                    .tag(1)

                MarketplaceTabView()
                    .tabItem {
                        Label("Apps", systemImage: "square.grid.2x2")
                    }
                    .accessibilityIdentifier("tab.apps")
                    .tag(MainTabView.appsTabIndex)

                ConnectView()
                    .tabItem {
                        Label("Connect", systemImage: "antenna.radiowaves.left.and.right")
                    }
                    .accessibilityIdentifier("tab.connect")
                    .tag(3)

                UsageView()
                    .tabItem {
                        Label("Usage", systemImage: "chart.bar")
                    }
                    .accessibilityIdentifier("tab.usage")
                    .tag(4)
            }
            .tint(Theme.accent)

            FloatingActionMenu(
                onAddCredential: { showAddCredential = true },
                onRedeemGift: { showRedeemGift = true },
                onAddApp: { showAppStore = true }
            )
            // Lift above the tab bar (49pt standard + safe-area inset).
            .padding(.trailing, 18)
            .padding(.bottom, 70)
        }
        .sheet(isPresented: $showAddCredential) {
            AddCredentialView()
                .environmentObject(wallet)
        }
        .sheet(isPresented: $showRedeemGift, onDismiss: {
            wallet.pendingGiftLink = nil
        }) {
            NavigationStack {
                RedeemGiftView(prefilledLink: wallet.pendingGiftLink)
            }
            .environmentObject(wallet)
        }
        .sheet(isPresented: $showAppStore) {
            AppStoreView()
                .environmentObject(wallet)
        }
    }
}

struct FloatingActionMenu: View {
    let onAddCredential: () -> Void
    let onRedeemGift: () -> Void
    let onAddApp: () -> Void

    var body: some View {
        Menu {
            Button {
                onAddCredential()
            } label: {
                Label("Add credential", systemImage: "key.fill")
            }
            .accessibilityIdentifier("fab.menu.addCredential")

            Button {
                onRedeemGift()
            } label: {
                Label("Redeem gift", systemImage: "gift.fill")
            }
            .accessibilityIdentifier("fab.menu.redeemGift")

            Button {
                onAddApp()
            } label: {
                Label("Add app", systemImage: "square.grid.2x2.fill")
            }
            .accessibilityIdentifier("fab.menu.addApp")
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 56, height: 56)
                .background(
                    LinearGradient(
                        colors: [Theme.accentHover, Theme.accent],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(Circle())
                .shadow(color: Theme.accent.opacity(0.4), radius: 12, x: 0, y: 6)
        }
        .accessibilityIdentifier("fab.button")
    }
}
