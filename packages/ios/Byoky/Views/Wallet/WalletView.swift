import SwiftUI

struct WalletView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showAddCredential = false
    @State private var showSettings = false
    @State private var showCloudVaultSetup = false
    @State private var showRedeemGift = false
    @State private var expandedCredentialId: String?
    @State private var renamingCredential: Credential?
    @State private var renameDraft: String = ""

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
                        OfflineUpgradeBanner(onActivate: { showCloudVaultSetup = true })
                            .padding(.horizontal)
                        emptyState
                    }
                } else {
                    VStack(spacing: 0) {
                        if !wallet.cloudVaultEnabled {
                            OfflineUpgradeBanner(onActivate: { showCloudVaultSetup = true })
                                .padding(.horizontal)
                        }
                        List {
                            credentialsSection
                            if !activeGifts.isEmpty {
                                giftsSection
                            }
                        }
                        .scrollContentBackground(.hidden)
                        .background(Theme.bgMain)
                    }
                }
            }
            .background(Theme.bgMain)
            .toolbarBackground(Theme.bgMain, for: .navigationBar)
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
                CloudVaultSetupView(lastUsername: wallet.cloudVaultLastUsername)
                    .environmentObject(wallet)
            }
            .alert("Rename credential", isPresented: Binding(
                get: { renamingCredential != nil },
                set: { if !$0 { renamingCredential = nil } }
            ), presenting: renamingCredential) { credential in
                TextField("Label", text: $renameDraft)
                    .accessibilityIdentifier("wallet.renameCredential.field")
                Button("Save") {
                    try? wallet.updateCredentialLabel(id: credential.id, newLabel: renameDraft)
                    renamingCredential = nil
                }
                Button("Cancel", role: .cancel) {
                    renamingCredential = nil
                }
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
                CredentialRow(
                    credential: credential,
                    isExpanded: expandedCredentialId == credential.id,
                    usage: providerUsage(for: credential.providerId),
                    onToggle: {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            expandedCredentialId = expandedCredentialId == credential.id ? nil : credential.id
                        }
                    },
                    onRename: {
                        renameDraft = credential.label
                        renamingCredential = credential
                    }
                )
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

    /// Aggregate the last 7 days of successful requests for a provider. Returned
    /// per-credential by querying providerId — multiple credentials of the same
    /// provider will share these numbers (the request log doesn't carry a
    /// credentialId), which is acceptable for an at-a-glance card.
    private func providerUsage(for providerId: String) -> CredentialUsage {
        let cutoff = Date().addingTimeInterval(-7 * 24 * 60 * 60)
        var usage = CredentialUsage(requests: 0, inputTokens: 0, outputTokens: 0)
        for log in wallet.requestLogs {
            guard log.timestamp >= cutoff else { continue }
            guard log.providerId == providerId else { continue }
            guard log.statusCode < 400 else { continue }
            usage.requests += 1
            usage.inputTokens += log.inputTokens ?? 0
            usage.outputTokens += log.outputTokens ?? 0
        }
        return usage
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

struct CredentialUsage {
    var requests: Int
    var inputTokens: Int
    var outputTokens: Int
}

struct CredentialRow: View {
    let credential: Credential
    let isExpanded: Bool
    let usage: CredentialUsage
    let onToggle: () -> Void
    let onRename: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                ProviderIcon(providerId: credential.providerId, size: 18)
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

                Button {
                    onRename()
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Rename credential")
                .accessibilityIdentifier("wallet.credential.rename")

                Text(credential.authMethod == .apiKey ? "API Key" : "OAuth")
                    .font(.caption2.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.systemGray5))
                    .clipShape(Capsule())

                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
            .onTapGesture { onToggle() }

            if isExpanded {
                Divider().padding(.top, 8)
                CredentialUsagePanel(usage: usage)
                    .padding(.top, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

private struct CredentialUsagePanel: View {
    let usage: CredentialUsage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LAST 7 DAYS")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)

            if usage.requests == 0 {
                Text("No usage in the last 7 days.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .italic()
            } else {
                HStack(spacing: 16) {
                    statColumn(value: "\(usage.requests)", label: "requests")
                    statColumn(value: formatWalletTokens(usage.inputTokens), label: "input")
                    statColumn(value: formatWalletTokens(usage.outputTokens), label: "output")
                }
            }
        }
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func statColumn(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                ProviderIcon(providerId: credential.providerId, size: 18)
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
