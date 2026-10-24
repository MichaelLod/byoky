import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var selectedTab: Int = 0
    @State private var showAddCredential = false
    @State private var showAddApp = false
    @State private var justAdded: InstalledApp?
    @State private var launchingApp: InstalledApp?

    private static let appsTabIndex = 1
    private static let connectedTabIndex = 2

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            TabView(selection: $selectedTab) {
                WalletView()
                    .tabItem {
                        Label("Wallet", systemImage: "wallet.bifold")
                    }
                    .accessibilityIdentifier("tab.wallet")
                    .tag(0)

                AppsTabView()
                    .tabItem {
                        Label("Apps", systemImage: "square.grid.2x2")
                    }
                    .accessibilityIdentifier("tab.apps")
                    .tag(MainTabView.appsTabIndex)

                AppsView()
                    .tabItem {
                        Label("Connected", systemImage: "link")
                    }
                    .accessibilityIdentifier("tab.connected")
                    .tag(MainTabView.connectedTabIndex)
            }
            .tint(Theme.accent)

            FloatingActionMenu(
                onAddCredential: { showAddCredential = true },
                onAddApp: { showAddApp = true }
            )
            // Lift above the tab bar (49pt standard + safe-area inset).
            .padding(.trailing, 18)
            .padding(.bottom, 70)
        }
        .sheet(isPresented: $showAddCredential) {
            AddCredentialView()
                .environmentObject(wallet)
        }
        .sheet(isPresented: $showAddApp, onDismiss: {
            guard let app = justAdded else { return }
            justAdded = nil
            selectedTab = MainTabView.appsTabIndex
            launchingApp = app
        }) {
            AddAppView(onAdded: { justAdded = $0 })
                .environmentObject(wallet)
        }
        .fullScreenCover(item: $launchingApp) { app in
            AppRuntimeView(app: app)
                .environmentObject(wallet)
        }
        // A .byoky file opened from Files, AirDrop or Mail.
        .sheet(item: $wallet.pendingBackupFile) { file in
            ImportBackupView(file: file)
                .environmentObject(wallet)
        }
    }
}

struct FloatingActionMenu: View {
    let onAddCredential: () -> Void
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
