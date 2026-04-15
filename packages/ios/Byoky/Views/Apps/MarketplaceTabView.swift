import SwiftUI

struct MarketplaceTabView: View {
    var body: some View {
        NavigationStack {
            InstalledAppsGrid()
                .navigationTitle("Apps")
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}
