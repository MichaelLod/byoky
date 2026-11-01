import SwiftUI

struct InstalledAppsGrid: View {
    @EnvironmentObject var wallet: WalletStore
    let onAddApp: () -> Void
    /// Opens an app in the in-wallet browser.
    let onOpenApp: (InstalledApp) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

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
        .contentMargins(.bottom, FloatingActionMenu.clearance, for: .scrollContent)
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
        // At accessibility text sizes the apps become rows, icon and name
        // side by side, so names aren't cut to one letter.
        let columns = typeSize.isAccessibilitySize ? 1 : 4
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: columns), spacing: 20) {
            ForEach(apps) { app in
                AppIconView(app: app, onOpen: onOpenApp)
            }
        }
        .padding(.horizontal)
    }
}

struct AppIconView: View {
    let app: InstalledApp
    let onOpen: (InstalledApp) -> Void
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showDisabledOptions = false

    var body: some View {
        SwiftUI.Group {
            if typeSize.isAccessibilitySize {
                // A row: the whole row opens the app.
                openButton {
                    HStack(spacing: 14) {
                        icon
                        name
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
            } else {
                VStack(spacing: 6) {
                    openButton { icon }
                    name
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
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
        .confirmationDialog("\(app.name) is disabled", isPresented: $showDisabledOptions, titleVisibility: .visible) {
            Button("Enable and Open") {
                wallet.toggleApp(app.id)
                var enabled = app
                enabled.enabled = true
                onOpen(enabled)
            }
            Button("Enable") {
                wallet.toggleApp(app.id)
            }
            Button("Remove", role: .destructive) {
                wallet.uninstallApp(app.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Disabled apps stay in your list but don't open.")
        }
    }

    private func openButton<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Button {
            // A disabled app doesn't open, but says why and how to fix it.
            if app.enabled { onOpen(app) } else { showDisabledOptions = true }
        } label: {
            label()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(app.name)
        .accessibilityValue(app.enabled ? "" : "Disabled")
        .accessibilityHint(app.enabled ? "Opens the app" : "Shows options to enable it")
    }

    private var icon: some View {
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

    private var name: some View {
        Text(app.name)
            .font(.mono(10.5, relativeTo: .caption2))
            .foregroundStyle(Theme.fog)
    }
}
