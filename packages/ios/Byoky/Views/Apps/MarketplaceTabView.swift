import SwiftUI

struct MarketplaceTabView: View {
    @State private var tab = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text("My Apps").tag(0)
                    Text("Sessions").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                if tab == 0 {
                    InstalledAppsGrid()
                } else {
                    AppsView()
                }
            }
            .navigationTitle("Apps")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
