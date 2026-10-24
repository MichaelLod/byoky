import SwiftUI

enum WalletStatsTarget: Identifiable, Equatable {
    case credential(String)

    var id: String {
        switch self {
        case .credential(let id): return "cred:\(id)"
        }
    }
}

struct WalletView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showAddCredential = false
    @State private var showSettings = false
    @State private var statsTarget: WalletStatsTarget?
    @State private var renamingCredential: Credential?
    @State private var editingEndpointFor: Credential?
    @State private var renameDraft: String = ""
    @State private var removingCredential: Credential?
    @State private var removeTitle = ""

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if wallet.credentials.isEmpty {
                    VStack {
                        retiredFeaturesBanner
                        emptyState
                    }
                } else {
                    VStack(spacing: 0) {
                        retiredFeaturesBanner
                        List {
                            credentialsSection
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
            }
            .sheet(isPresented: $showAddCredential) {
                AddCredentialView()
            }
            .sheet(isPresented: $showSettings) {
                NavigationStack {
                    SettingsView()
                }
            }
            .sheet(item: $statsTarget) { target in
                NavigationStack {
                    WalletStatsSheet(target: target)
                        .environmentObject(wallet)
                }
                .presentationDetents([.medium, .large])
            }
            .sheet(item: $editingEndpointFor) { credential in
                EndpointEditorView(credential: credential)
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
            .alert(removeTitle, isPresented: Binding(
                get: { removingCredential != nil },
                set: { if !$0 { removingCredential = nil } }
            ), presenting: removingCredential) { credential in
                Button("Remove", role: .destructive) {
                    try? wallet.removeCredential(credential)
                    removingCredential = nil
                }
                Button("Cancel", role: .cancel) {
                    removingCredential = nil
                }
            } message: { _ in
                Text("Apps using this key lose access to it. This can't be undone unless you have a backup that includes it.")
            }
        }
    }

    @ViewBuilder
    private var retiredFeaturesBanner: some View {
        if wallet.showRetiredFeaturesNotice {
            RetiredFeaturesBanner(onDismiss: { wallet.dismissRetiredFeaturesNotice() })
                .padding(.horizontal)
                // Shown once: seen now means gone on the next launch.
                .onAppear { wallet.markRetiredFeaturesNoticeShown() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "key.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color(.systemGray3))

            Text("No keys yet")
                .font(.headline)

            Text("Add your first API key to get started. Keys are encrypted with your master password and stored in the iOS Keychain on this device.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                showAddCredential = true
            } label: {
                Label("Add API Key", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .accessibilityIdentifier("wallet.addCredentialEmpty")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var credentialsSection: some View {
        Section {
            ForEach(wallet.credentials) { credential in
                CredentialRow(
                    credential: credential,
                    usage: providerUsage(for: credential.providerId),
                    onOpenStats: { statsTarget = .credential(credential.id) },
                    onEditEndpoint: { editingEndpointFor = credential },
                    onRename: {
                        renameDraft = credential.label
                        renamingCredential = credential
                    }
                )
            }
            // Swipe-to-delete asks first; a full swipe used to remove the key
            // straight away.
            .onDelete { offsets in
                guard let credential = offsets.first.map({ wallet.credentials[$0] }) else { return }
                removeTitle = "Remove \(credential.label)?"
                removingCredential = credential
            }
        } header: {
            Text("\(wallet.credentials.count) credential\(wallet.credentials.count == 1 ? "" : "s")")
        }
    }

    /// Aggregate the last 7 days of successful requests for a provider.
    /// Multiple credentials of the same provider share these numbers —
    /// the request log carries `providerId` only.
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
}

/// One-time notice for users who relied on cloud sync, gifts or pairing
/// before Byoky became a purely local wallet. It appears on one launch only;
/// within that session it stays until dismissed.
private struct RetiredFeaturesBanner: View {
    let onDismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Byoky is now fully local")
                    .font(.subheadline.bold())
                    .foregroundStyle(Theme.textPrimary)
                Text("Cloud sync, gifts and phone pairing have been retired. Your keys on this device are untouched. To move keys to another device, use Export in Settings.")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
            .accessibilityIdentifier("wallet.retiredNotice.dismiss")
        }
        .padding(12)
        .background(Theme.accent.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Theme.accent, lineWidth: 1)
        )
        .padding(.bottom, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("wallet.retiredNotice")
    }
}

/// Set the endpoint (Azure) or server URL (Ollama, LM Studio) of an existing
/// credential. Validated with the same rules as import and Add Credential.
struct EndpointEditorView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss
    let credential: Credential

    @State private var endpoint = ""
    @State private var error: String?

    private var isAzure: Bool { credential.providerId == "azure_openai" }
    private var isValid: Bool { Provider.normalizedEndpoint(endpoint, for: credential.providerId) != nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(isAzure ? "https://<resource>.openai.azure.com" : "http://localhost:11434", text: $endpoint)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .fontDesign(.monospaced)
                        .accessibilityIdentifier("endpointEditor.field")
                    if !endpoint.trimmingCharacters(in: .whitespaces).isEmpty && !isValid {
                        Text(isAzure
                             ? "Use your resource endpoint, like https://contoso.openai.azure.com"
                             : "Use http://localhost:<port>, http://127.0.0.1:<port>, or an https:// address")
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }
                } header: {
                    Text(credential.label)
                } footer: {
                    Text(isAzure
                         ? "Your Azure OpenAI resource endpoint, from Keys and Endpoint in the Azure portal. This key is only ever sent to this endpoint."
                         : "Where this server is running. This key is only ever sent there.")
                }

                if let error {
                    Section {
                        Text(error).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle(isAzure ? "Azure Endpoint" : "Server URL")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        do {
                            try wallet.updateCredentialEndpoint(id: credential.id, endpoint: endpoint)
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                    .disabled(!isValid)
                    .accessibilityIdentifier("endpointEditor.save")
                }
            }
            .onAppear { endpoint = credential.baseUrl ?? "" }
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
    let usage: CredentialUsage
    let onOpenStats: () -> Void
    let onEditEndpoint: () -> Void
    let onRename: () -> Void

    private var needsEndpoint: Bool {
        Provider.find(credential.providerId)?.requiresCustomBaseUrl == true
    }

    private var missingEndpoint: Bool {
        Provider.missingEndpointMessage(providerId: credential.providerId, credentialBaseUrl: credential.baseUrl) != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                ProviderIcon(providerId: credential.providerId, size: 18)
                    .foregroundStyle(Color.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black)
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
            }

            if needsEndpoint {
                if missingEndpoint {
                    // Keys without their own endpoint are never sent anywhere.
                    Button(action: onEditEndpoint) {
                        Label(credential.providerId == "azure_openai" ? "Add endpoint" : "Add server URL",
                              systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("wallet.credential.addEndpoint")
                } else if let endpoint = credential.baseUrl {
                    Button(action: onEditEndpoint) {
                        Text(endpoint)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Endpoint \(endpoint). Edit")
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("LAST 7 DAYS")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)

                HStack(spacing: 16) {
                    statColumn(value: "\(usage.requests)", label: "requests")
                    statColumn(value: formatWalletTokens(usage.inputTokens), label: "input")
                    statColumn(value: formatWalletTokens(usage.outputTokens), label: "output")
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture { onOpenStats() }
    }

    private func statColumn(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.headline)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

func formatWalletTokens(_ n: Int) -> String {
    if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
    if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
    return "\(n)"
}
