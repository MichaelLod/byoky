import SwiftUI

struct ConnectView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var selectedMode = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Mode", selection: $selectedMode) {
                    Text("Pair").tag(0)
                    Text("Sessions").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                if selectedMode == 0 {
                    PairView()
                } else {
                    AppsView()
                }
            }
            .background(Theme.bgMain)
            .toolbarBackground(Theme.bgMain, for: .navigationBar)
            .navigationTitle("Connect")
            .onChange(of: wallet.pendingPairLink) { _, newValue in
                if newValue != nil { selectedMode = 0 }
            }
        }
    }
}
