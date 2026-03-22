import SwiftUI

struct WalletView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showAddCredential = false

    var body: some View {
        NavigationStack {
            List {
                if wallet.credentials.isEmpty {
                    emptyState
                } else {
                    credentialsList
                }
            }
            .navigationTitle("Wallet")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showAddCredential = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showAddCredential) {
                AddCredentialView()
            }
        }
    }

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "key.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(Color(.systemGray3))

                Text("No API Keys")
                    .font(.headline)

                Text("Add your first API key to get started. Keys are encrypted with your master password and stored in the iOS Keychain.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    showAddCredential = true
                } label: {
                    Label("Add API Key", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private var credentialsList: some View {
        Section {
            ForEach(wallet.credentials) { credential in
                CredentialRow(credential: credential)
            }
            .onDelete { offsets in
                for index in offsets {
                    try? wallet.removeCredential(wallet.credentials[index])
                }
            }
        } header: {
            Text("\(wallet.credentials.count) credential\(wallet.credentials.count == 1 ? "" : "s")")
        }
    }
}

struct CredentialRow: View {
    let credential: Credential

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: Provider.find(credential.providerId)?.icon ?? "key")
                .font(.system(size: 18))
                .foregroundStyle(Theme.accent)
                .frame(width: 36, height: 36)
                .background(Theme.accent.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(credential.label)
                    .font(.body.weight(.medium))
                Text(Provider.find(credential.providerId)?.name ?? credential.providerId)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(credential.authMethod == .apiKey ? "API Key" : "OAuth")
                .font(.caption2.weight(.medium))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color(.systemGray5))
                .clipShape(Capsule())
        }
        .padding(.vertical, 4)
    }
}
