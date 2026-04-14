import SwiftUI

struct WalletView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showAddCredential = false
    @State private var showSettings = false
    @State private var showCloudVaultSetup = false
    @State private var showRedeemGift = false

    private var activeGifts: [GiftedCredential] {
        wallet.giftedCredentials.filter { !isGiftedCredentialExpired($0) }
    }

    private var hasAny: Bool {
        !wallet.credentials.isEmpty || !activeGifts.isEmpty
    }

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if !hasAny {
                    VStack {
                        OfflineUpgradeBanner()
                            .padding(.horizontal)
                        emptyState
                    }
                } else {
                    List {
                        if !wallet.cloudVaultEnabled {
                            Section {
                                OfflineUpgradeBanner()
                                    .listRowInsets(EdgeInsets())
                                    .listRowBackground(Color.clear)
                            }
                        }
                        credentialsSection
                        if !activeGifts.isEmpty {
                            giftsSection
                        }
                    }
                }
            }
            .navigationTitle("Wallet")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityIdentifier("wallet.settings")
                }
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 12) {
                        Button {
                            if wallet.cloudVaultEnabled {
                                Task { await wallet.disableCloudVault() }
                            } else {
                                showCloudVaultSetup = true
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text("Cloud Sync")
                                    .font(.subheadline)
                                Image(systemName: wallet.cloudVaultEnabled ? "cloud.fill" : "icloud.slash")
                            }
                            .foregroundStyle(wallet.cloudVaultEnabled ? Theme.accent : .secondary)
                        }
                        .accessibilityIdentifier("wallet.vaultToggle")

                        Menu {
                            Button {
                                showAddCredential = true
                            } label: {
                                Label("Add credential", systemImage: "key.fill")
                            }
                            .accessibilityIdentifier("wallet.menu.addCredential")
                            Button {
                                showRedeemGift = true
                            } label: {
                                Label("Redeem gift", systemImage: "gift.fill")
                            }
                            .accessibilityIdentifier("wallet.menu.redeemGift")
                        } label: {
                            Image(systemName: "plus.circle.fill")
                        }
                        .accessibilityIdentifier("wallet.addMenu")
                    }
                }
            }
            .sheet(isPresented: $showAddCredential) {
                AddCredentialView()
            }
            .sheet(isPresented: $showRedeemGift, onDismiss: {
                // Clear the deep-link trigger so the sheet doesn't re-open
                // on the next state tick.
                wallet.pendingGiftLink = nil
            }) {
                NavigationStack {
                    RedeemGiftView(prefilledLink: wallet.pendingGiftLink)
                }
                .environmentObject(wallet)
            }
            .onChange(of: wallet.pendingGiftLink) { _, newValue in
                if newValue != nil { showRedeemGift = true }
            }
            .sheet(isPresented: $showSettings) {
                NavigationStack {
                    SettingsView()
                }
            }
            .sheet(isPresented: $showCloudVaultSetup) {
                CloudVaultSetupView()
                    .environmentObject(wallet)
            }
            .task {
                // Re-probe every 15s while the Wallet is visible so the dot
                // self-heals if the sender WS briefly blinks. A single
                // on-appear probe would latch offline if it happened to land
                // in a reconnect gap. Auto-cancels on view disappear.
                while !Task.isCancelled {
                    wallet.probeGiftPeers()
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "key.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color(.systemGray3))

            Text("No credentials or gifts")
                .font(.headline)

            Text("Add your first API key or redeem a gift to get started. Keys are encrypted with your master password and stored in the iOS Keychain.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            HStack(spacing: 12) {
                Button {
                    showAddCredential = true
                } label: {
                    Label("Add API Key", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .accessibilityIdentifier("wallet.addCredentialEmpty")

                Button {
                    showRedeemGift = true
                } label: {
                    Label("Redeem Gift", systemImage: "gift")
                }
                .buttonStyle(.bordered)
                .tint(Theme.accent)
                .accessibilityIdentifier("wallet.redeemGiftEmpty")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var credentialsSection: some View {
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

    private var giftsSection: some View {
        Section {
            ForEach(activeGifts) { gc in
                GiftCredentialRow(credential: gc)
            }
            .onDelete { offsets in
                let items = activeGifts
                for index in offsets {
                    wallet.removeGiftedCredential(id: items[index].id)
                }
            }
        } header: {
            Text("\(activeGifts.count) gift\(activeGifts.count == 1 ? "" : "s")")
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

/// Inline row that renders a received gift as a wallet credential. Same
/// structural shape as `CredentialRow` plus a sender label, peer online dot,
/// tokens-remaining progress bar, and a gift badge instead of API Key/OAuth.
struct GiftCredentialRow: View {
    @EnvironmentObject var wallet: WalletStore
    let credential: GiftedCredential

    private var providerName: String {
        Provider.find(credential.providerId)?.name ?? credential.providerName
    }

    private var providerIcon: String {
        Provider.find(credential.providerId)?.icon ?? "gift"
    }

    private var remaining: Int {
        giftedBudgetRemaining(credential)
    }

    private var percent: Double {
        giftedBudgetPercent(credential)
    }

    private var expiryText: String {
        if isGiftedCredentialExpired(credential) { return "Expired" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: credential.expiresAt, relativeTo: Date())
    }

    /// nil = not yet probed (checking). true = sender online. false = offline.
    private var onlineState: Bool? {
        wallet.giftPeerOnline[credential.giftId]
    }

    private var hasOwnKey: Bool {
        wallet.credentials.contains { $0.providerId == credential.providerId }
    }

    private var isPreferred: Bool {
        wallet.giftPreferences[credential.providerId] == credential.giftId
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 14) {
                Image(systemName: providerIcon)
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 36, height: 36)
                    .background(Theme.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(onlineColor)
                            .frame(width: 6, height: 6)
                            .help(onlineHelpText)
                        Text(providerName)
                            .font(.body.weight(.medium))
                    }
                    Text("Gift from \(credential.senderLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Text("Gift")
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Theme.accent.opacity(0.15))
                    .foregroundStyle(Theme.accent)
                    .clipShape(Capsule())
            }

            ProgressView(value: percent)
                .tint(percent > 0.9 ? .red : Theme.accent)

            HStack {
                Text("\(formatWalletTokens(remaining)) / \(formatWalletTokens(credential.maxTokens)) left")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(expiryText)
                    .font(.caption2)
                    .foregroundStyle(isGiftedCredentialExpired(credential) ? .red : .secondary)
            }

            if hasOwnKey && !isGiftedCredentialExpired(credential) {
                Toggle("Use instead of own key", isOn: Binding(
                    get: { isPreferred },
                    set: { wallet.setGiftPreference(providerId: credential.providerId, giftId: $0 ? credential.giftId : nil) }
                ))
                .font(.caption)
                .tint(Theme.accent)
            }
        }
        .padding(.vertical, 4)
    }

    private var onlineColor: Color {
        switch onlineState {
        case .some(true): return .green
        case .some(false): return .red
        case nil: return .orange
        }
    }

    private var onlineHelpText: String {
        switch onlineState {
        case .some(true): return "Sender online — gift can be used"
        case .some(false): return "Sender offline — gift will fail until sender reconnects"
        case nil: return "Checking sender status…"
        }
    }
}

private func formatWalletTokens(_ n: Int) -> String {
    if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
    if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
    return "\(n)"
}
