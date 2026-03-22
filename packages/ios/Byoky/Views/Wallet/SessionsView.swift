import SwiftUI

struct SessionsView: View {
    @EnvironmentObject var wallet: WalletStore

    var body: some View {
        NavigationStack {
            List {
                if wallet.sessions.isEmpty {
                    emptyState
                } else {
                    activeSessions
                }
            }
            .navigationTitle("Sessions")
        }
    }

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "link")
                    .font(.system(size: 40))
                    .foregroundStyle(Color(.systemGray3))

                Text("No Active Sessions")
                    .font(.headline)

                Text("When you approve a website to use your API keys, its session will appear here. You can revoke access at any time.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private var activeSessions: some View {
        Section {
            ForEach(Array(wallet.sessions)) { session in
                VStack(alignment: .leading, spacing: 6) {
                    Text(session.appOrigin)
                        .font(.body.weight(.medium))

                    HStack(spacing: 12) {
                        Label("\(session.providers.count) provider\(session.providers.count == 1 ? "" : "s")", systemImage: "cpu")
                        Text(session.expiresAt, format: .relative(presentation: .named))
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        try? wallet.revokeSession(session)
                    } label: {
                        Label("Revoke", systemImage: "xmark.circle")
                    }
                }
            }
        } header: {
            Text("\(wallet.sessions.count) active session\(wallet.sessions.count == 1 ? "" : "s")")
        }
    }
}
