import SwiftUI

struct InstalledAppsGrid: View {
    @EnvironmentObject var wallet: WalletStore
    let onAddApp: () -> Void

    private var enabledApps: [InstalledApp] { wallet.installedApps.filter(\.enabled) }
    private var disabledApps: [InstalledApp] { wallet.installedApps.filter { !$0.enabled } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ScreenHeader(
                    title: "Apps",
                    status: "\(wallet.installedApps.count) app\(wallet.installedApps.count == 1 ? "" : "s") · built-in browser",
                    statusColor: Theme.phosphor
                )
                .padding(.horizontal, 20)

                if wallet.installedApps.isEmpty {
                    emptyState
                } else {
                    appGrid(apps: enabledApps)

                    if !disabledApps.isEmpty {
                        SectionLabel("Disabled")
                            .padding(.horizontal, 20)

                        appGrid(apps: disabledApps)
                            .opacity(0.4)
                    }
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            PromptLine("No apps yet")
            Text("Add a web app that supports Byoky by its address. It opens in the built-in browser and uses the keys in this wallet without ever seeing them.")
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Add App by URL", action: onAddApp)
                .buttonStyle(.retroPrimary)
                .padding(.top, 6)
                .accessibilityIdentifier("apps.addAppEmpty")
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .retroCard()
        .padding(.horizontal, 16)
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
    @State private var openRequest: InstalledApp?

    var body: some View {
        VStack(spacing: 6) {
            Button {
                if app.enabled { openRequest = app }
            } label: {
                AsyncImage(url: URL(string: app.icon)) { image in
                    image.resizable().aspectRatio(contentMode: .fill)
                } placeholder: {
                    Rectangle()
                        .fill(Theme.violetSoft)
                        .overlay {
                            Text(String(app.name.prefix(1)))
                                .uppercaseDisplay()
                                .font(.display(24, relativeTo: .title2))
                                .foregroundStyle(Theme.lilac)
                        }
                }
                .frame(width: 56, height: 56)
                .background(Theme.ink)
                .clipped()
                .overlay(Rectangle().strokeBorder(Theme.seamStrong, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(app.name)

            Text(app.name)
                .font(.mono(10.5, relativeTo: .caption2))
                .foregroundStyle(Theme.fog)
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
                Label("Remove", systemImage: "trash")
            }
        }
        .opensInstalledApp($openRequest)
    }
}
