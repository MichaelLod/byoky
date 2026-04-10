import SwiftUI

private let marketplaceURL = "https://byoky.com/api/apps"

struct AppStoreView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss
    @State private var apps: [MarketplaceApp] = []
    @State private var loading = true
    @State private var error: String?
    @State private var search = ""

    private var installedIds: Set<String> {
        Set(wallet.installedApps.map(\.id))
    }

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if loading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    VStack(spacing: 8) {
                        Text("Failed to load apps")
                            .foregroundStyle(Theme.textSecondary)
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(Theme.textMuted)
                        Button("Retry") { Task { await fetchApps() } }
                            .buttonStyle(.bordered)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if apps.isEmpty {
                    Text("No apps found")
                        .foregroundStyle(Theme.textMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(apps) { app in
                        StoreAppRow(app: app, installed: installedIds.contains(app.id)) {
                            wallet.installApp(app)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("App Store")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "Search apps")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await fetchApps() }
            .onChange(of: search) { _, _ in
                Task { await fetchApps() }
            }
        }
    }

    private func fetchApps() async {
        do {
            var components = URLComponents(string: "\(marketplaceURL)/api/apps")!
            if !search.isEmpty {
                components.queryItems = [URLQueryItem(name: "search", value: search)]
            }
            let (data, _) = try await URLSession.shared.data(from: components.url!)
            let response = try JSONDecoder().decode(MarketplaceResponse.self, from: data)
            apps = response.apps
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

private struct StoreAppRow: View {
    let app: MarketplaceApp
    let installed: Bool
    let onInstall: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: URL(string: app.icon)) { image in
                image.resizable().aspectRatio(contentMode: .fill)
            } placeholder: {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Theme.accentSoft)
                    .overlay {
                        Text(String(app.name.prefix(1)))
                            .font(.title3)
                            .fontWeight(.bold)
                            .foregroundStyle(Theme.accent)
                    }
            }
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(app.name).fontWeight(.semibold)
                    if app.verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundStyle(Theme.success)
                    }
                }
                Text(app.author.name)
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
                Text(app.description)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)

                HStack(spacing: 4) {
                    ForEach(app.providers, id: \.self) { provider in
                        Text(provider)
                            .font(.system(size: 10, weight: .semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Theme.accentSoft)
                            .foregroundStyle(Theme.accent)
                            .clipShape(Capsule())
                    }
                }
                .padding(.top, 2)
            }

            Spacer()

            Button(installed ? "Installed" : "Install") { onInstall() }
                .buttonStyle(.borderedProminent)
                .tint(installed ? Theme.bgCard : Theme.accent)
                .disabled(installed)
                .font(.caption)
        }
        .padding(.vertical, 4)
    }
}
