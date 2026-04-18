import SwiftUI

struct InstalledAppsGrid: View {
    @EnvironmentObject var wallet: WalletStore
    let onBrowseStore: () -> Void
    @State private var popularApps: [MarketplaceApp] = []

    private var enabledApps: [InstalledApp] { wallet.installedApps.filter(\.enabled) }
    private var disabledApps: [InstalledApp] { wallet.installedApps.filter { !$0.enabled } }
    private var installedIds: Set<String> { Set(wallet.installedApps.map(\.id)) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if wallet.installedApps.isEmpty {
                    emptyState
                    if !popularApps.isEmpty {
                        popularSection
                    }
                } else {
                    appGrid(apps: enabledApps)

                    if !disabledApps.isEmpty {
                        Text("DISABLED")
                            .font(.caption2)
                            .fontWeight(.semibold)
                            .foregroundStyle(Theme.textMuted)
                            .padding(.horizontal)

                        appGrid(apps: disabledApps)
                            .opacity(0.4)
                    }
                }
            }
            .padding(.top, 16)
        }
        .task {
            if wallet.installedApps.isEmpty && popularApps.isEmpty {
                await fetchPopular()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 40))
                .foregroundStyle(Theme.textMuted)
            Text("No apps installed")
                .foregroundStyle(Theme.textSecondary)
            Text("Browse the store to find apps that use your API keys.")
                .font(.caption)
                .foregroundStyle(Theme.textMuted)
                .multilineTextAlignment(.center)
            Button("Browse Store", action: onBrowseStore)
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }

    private var popularSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("POPULAR APPS")
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textMuted)
                .padding(.horizontal)
            VStack(spacing: 8) {
                ForEach(popularApps) { app in
                    StoreAppRow(app: app, installed: installedIds.contains(app.id)) {
                        wallet.installApp(app)
                    }
                    .padding(.horizontal)
                }
            }
        }
    }

    private func fetchPopular() async {
        do {
            let url = URL(string: marketplaceURL)!
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(MarketplaceResponse.self, from: data)
            popularApps = Array(response.apps.prefix(10))
        } catch {
            // Silent — empty state already shown above.
        }
    }

    private func appGrid(apps: [InstalledApp]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 20) {
            ForEach(apps) { app in
                AppIconView(app: app)
            }
        }
        .padding(.horizontal)
    }
}

struct AppIconView: View {
    let app: InstalledApp
    @EnvironmentObject var wallet: WalletStore
    @State private var showRuntime = false

    var body: some View {
        VStack(spacing: 6) {
            Button {
                if app.enabled { showRuntime = true }
            } label: {
                AsyncImage(url: URL(string: app.icon)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(Theme.accentSoft)
                        .overlay {
                            Text(String(app.name.prefix(1)))
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundStyle(Theme.accent)
                        }
                }
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)

            Text(app.name)
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
                .frame(maxWidth: 70)
        }
        .contextMenu {
            Button {
                wallet.toggleApp(app.id)
            } label: {
                Label(app.enabled ? "Disable" : "Enable", systemImage: app.enabled ? "power" : "power.circle")
            }
            Button(role: .destructive) {
                wallet.uninstallApp(app.id)
            } label: {
                Label("Uninstall", systemImage: "trash")
            }
        }
        .fullScreenCover(isPresented: $showRuntime) {
            AppRuntimeView(app: app)
        }
    }
}
