import SwiftUI

/// The Apps tab: web apps the user added by URL. Tapping one opens it in the
/// in-wallet browser; the "+" button adds another and opens it right away.
struct AppsTabView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showAddApp = false
    @State private var justAdded: InstalledApp?
    @State private var launchingApp: InstalledApp?

    var body: some View {
        NavigationStack {
            InstalledAppsGrid(onAddApp: { showAddApp = true })
                .background(Theme.bgMain)
                .toolbarBackground(Theme.bgMain, for: .navigationBar)
                .navigationTitle("Apps")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showAddApp = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("Add app")
                        .accessibilityIdentifier("apps.addApp")
                    }
                }
                .sheet(isPresented: $showAddApp, onDismiss: {
                    // Open the new app once the sheet is fully gone —
                    // presenting the cover while it animates out is dropped.
                    launchingApp = justAdded
                    justAdded = nil
                }) {
                    AddAppView(onAdded: { justAdded = $0 })
                        .environmentObject(wallet)
                }
                .opensInstalledApp($launchingApp)
        }
    }
}
