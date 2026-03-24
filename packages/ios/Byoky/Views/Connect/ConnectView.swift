import SwiftUI

struct ConnectView: View {
    @State private var selectedMode = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Mode", selection: $selectedMode) {
                    Text("Pair").tag(0)
                    Text("Bridge").tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                if selectedMode == 0 {
                    PairView()
                } else {
                    BridgeView()
                }
            }
            .navigationTitle("Connect")
        }
    }
}
