import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var selectedTab: Int = 0
    @State private var showAddCredential = false
    @State private var showAddApp = false
    @State private var justAdded: InstalledApp?
    @State private var launchingApp: InstalledApp?
    @Environment(\.horizontalSizeClass) private var sizeClass

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
            .tint(Theme.lilac)

            FloatingActionMenu(
                onAddCredential: { showAddCredential = true },
                onAddApp: { showAddApp = true }
            )
            .padding(.trailing, 18)
            .padding(.bottom, fabLift)
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
        .opensInstalledApp($launchingApp)
        // A .byoky file opened from Files, AirDrop or Mail.
        .sheet(item: $wallet.pendingBackupFile) { file in
            ImportBackupView(file: file)
                .environmentObject(wallet)
        }
    }
}

extension MainTabView {
    /// Lifts the + button above the tab bar at the bottom. iPadOS 18 and
    /// later put the tab bar at the top in regular width, so there the
    /// button sits near the bottom edge.
    private var fabLift: CGFloat {
        if #available(iOS 18, *), UIDevice.current.userInterfaceIdiom == .pad, sizeClass == .regular {
            return 18
        }
        return 70
    }
}

struct FloatingActionMenu: View {
    /// Room scrolling content leaves at its end so the last rows can scroll
    /// out from under the + button (64pt with its halo, plus a gap).
    static let clearance: CGFloat = 88

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

            // The Apps tab's symbol. A menu item with square.grid.2x2.fill
            // is read by its symbol name, "Large Grid", whatever its title
            // or accessibilityLabel says.
            Button {
                onAddApp()
            } label: {
                Label("Add app", systemImage: "square.grid.2x2")
            }
            .accessibilityIdentifier("fab.menu.addApp")
        } label: {
            // Square violet key with a soft violet halo, as in the design.
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Theme.violet)
                .padding(4)
                .background(Theme.violet.opacity(0.2))
        }
        .accessibilityIdentifier("fab.button")
    }
}
