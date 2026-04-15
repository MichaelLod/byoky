import SwiftUI

struct MarketplaceTabView: View {
    @State private var showStore = false

    var body: some View {
        NavigationStack {
            InstalledAppsGrid(onBrowseStore: { showStore = true })
                .navigationTitle("Apps")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            showStore = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityIdentifier("apps.browseStore")
                    }
                }
                .sheet(isPresented: $showStore) {
                    AppStoreView()
                }
        }
    }
}
