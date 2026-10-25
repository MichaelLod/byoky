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
    @State private var greetings = 0
    @State private var greeted = false

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if wallet.credentials.isEmpty {
                    ScrollView {
                        VStack(spacing: 16) {
                            header
                            retiredFeaturesBanner
                            emptyState
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 24)
                    }
                } else {
                    List {
                        header
                            .walletListRow(top: 4, bottom: 8)
                        retiredFeaturesBanner
                            .walletListRow()
                        credentialsSection
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(ScreenBackground())
            .navigationBarTitleDisplayMode(.inline)
            // The screen header below is the title; the bar only holds the gear.
            .toolbarBackground(.hidden, for: .navigationBar)
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

    /// Status, the screen title and Muninn keeping watch.
    private var header: some View {
        let count = wallet.credentials.count
        return ScreenHeader(
            title: "Wallet",
            status: "Unlocked · \(count) key\(count == 1 ? "" : "s")"
        ) {
            Muninn(mood: .watching, size: 96, compact: true, nod: greetings)
                .task {
                    // One nod as the wallet opens, once the unlock cross-fade is done.
                    guard !greeted else { return }
                    greeted = true
                    try? await Task.sleep(for: .milliseconds(400))
                    greetings += 1
                }
        }
        .padding(.leading, 4)
    }

    @ViewBuilder
    private var retiredFeaturesBanner: some View {
        if wallet.showRetiredFeaturesNotice {
            RetiredFeaturesBanner(onDismiss: { wallet.dismissRetiredFeaturesNotice() })
                // Shown once: seen now means gone on the next launch.
                .onAppear { wallet.markRetiredFeaturesNoticeShown() }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            PromptLine("No keys yet")

            Text("Add your first API key to get started. Keys are encrypted with your master password and stored in the iOS Keychain on this device.")
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                showAddCredential = true
            } label: {
                Label("Add API Key", systemImage: "plus")
            }
            .buttonStyle(.retroPrimary)
            .padding(.top, 6)
            .accessibilityIdentifier("wallet.addCredentialEmpty")
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .retroCard()
    }

    @ViewBuilder
    private var credentialsSection: some View {
        SectionLabel("\(wallet.credentials.count) credential\(wallet.credentials.count == 1 ? "" : "s")")
            .walletListRow(top: 10, bottom: 2)

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
            .walletListRow(top: 5, bottom: 5)
        }
        // Swipe-to-delete asks first; a full swipe used to remove the key
        // straight away.
        .onDelete { offsets in
            guard let credential = offsets.first.map({ wallet.credentials[$0] }) else { return }
            removeTitle = "Remove \(credential.label)?"
            removingCredential = credential
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
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel("Notice", color: Theme.phosphor)
                Text("Byoky is now fully local")
                    .font(.subheadline.bold())
                    .foregroundStyle(Theme.bone)
                Text("Cloud sync, gifts and phone pairing have been retired. Your keys on this device are untouched. To move keys to another device, use Export in Settings.")
                    .font(.caption)
                    .foregroundStyle(Theme.fog)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundStyle(Theme.dim)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
            .accessibilityIdentifier("wallet.retiredNotice.dismiss")
        }
        .padding(14)
        .retroCard(border: Theme.seamStrong)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("wallet.retiredNotice")
    }
}

private extension View {
    /// A wallet list row that draws its own card: no system background,
    /// separator or inset beyond the screen gutter.
    func walletListRow(top: CGFloat = 0, bottom: CGFloat = 0) -> some View {
        listRowInsets(EdgeInsets(top: top, leading: 16, bottom: bottom, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
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
            List {
                Section {
                    TextField(isAzure ? "https://<resource>.openai.azure.com" : "http://localhost:11434", text: $endpoint)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.mono(15))
                        .accessibilityIdentifier("endpointEditor.field")
                    if !endpoint.trimmingCharacters(in: .whitespaces).isEmpty && !isValid {
                        Text(isAzure
                             ? "Use your resource endpoint, like https://contoso.openai.azure.com"
                             : "Use http://localhost:<port>, http://127.0.0.1:<port>, or an https:// address")
                            .font(.caption)
                            .foregroundStyle(Theme.alarm)
                    }
                } header: {
                    ListHeader(credential.label)
                } footer: {
                    ListFooter(isAzure
                         ? "Your Azure OpenAI resource endpoint, from Keys and Endpoint in the Azure portal. This key is only ever sent to this endpoint."
                         : "Where this server is running. This key is only ever sent there.")
                }
                .retroRow()

                if let error {
                    Section {
                        Text(error).foregroundStyle(Theme.alarm)
                    }
                    .retroRow(border: Theme.alarm)
                }
            }
            .retroList()
            .retroNavigationTitle(isAzure ? "Azure Endpoint" : "Server URL")
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
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                ProviderTile(providerId: credential.providerId, size: 40)

                VStack(alignment: .leading, spacing: 3) {
                    Text(credential.label)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.bone)
                    Text(Provider.find(credential.providerId)?.name ?? credential.providerId)
                        .font(.mono(12, relativeTo: .caption))
                        .foregroundStyle(Theme.dim)
                }

                Spacer()

                Button {
                    onRename()
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.dim)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Rename credential")
                .accessibilityIdentifier("wallet.credential.rename")

                Text(credential.authMethod == .apiKey ? "API Key" : "OAuth")
                    .uppercaseDisplay()
                    .font(.mono(11, relativeTo: .caption2))
                    .tracking(0.8)
                    .foregroundStyle(credential.authMethod == .apiKey ? Theme.fog : Theme.phosphor)
            }

            if needsEndpoint {
                if missingEndpoint {
                    // Keys without their own endpoint are never sent anywhere.
                    Button(action: onEditEndpoint) {
                        Label(credential.providerId == "azure_openai" ? "Add endpoint" : "Add server URL",
                              systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.amber)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("wallet.credential.addEndpoint")
                } else if let endpoint = credential.baseUrl {
                    Button(action: onEditEndpoint) {
                        Text(endpoint)
                            .font(.mono(12, relativeTo: .caption))
                            .foregroundStyle(Theme.fog)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Endpoint \(endpoint). Edit")
                }
            }

            Rectangle()
                .fill(Theme.seam)
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Last 7 days")

                HStack(spacing: 16) {
                    statColumn(value: "\(usage.requests)", label: "requests")
                    statColumn(value: formatWalletTokens(usage.inputTokens), label: "input")
                    statColumn(value: formatWalletTokens(usage.outputTokens), label: "output")
                }
            }
        }
        .padding(14)
        .retroCard()
        .contentShape(Rectangle())
        .onTapGesture { onOpenStats() }
    }

    private func statColumn(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.mono(17, weight: .medium, relativeTo: .headline))
                .foregroundStyle(Theme.bone)
            Text(label)
                .uppercaseDisplay()
                .font(.mono(10, relativeTo: .caption2))
                .tracking(1)
                .foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

func formatWalletTokens(_ n: Int) -> String {
    if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
    if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
    return "\(n)"
}
