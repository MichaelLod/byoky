import SwiftUI

struct AddCredentialView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var selectedProvider: Provider?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(Provider.all) { provider in
                        NavigationLink(value: provider) {
                            HStack(spacing: 12) {
                                ProviderIcon(providerId: provider.id, size: 18)
                                    .foregroundStyle(Color.white)
                                    .frame(width: 32, height: 32)
                                    .background(Color.black)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))

                                Text(provider.name)
                                    .foregroundStyle(.primary)
                            }
                        }
                        .accessibilityIdentifier("addCredential.provider.\(provider.id)")
                    }
                } header: {
                    Text("Provider")
                } footer: {
                    Text("Select the AI provider for this credential.")
                }
            }
            .navigationTitle("Add API Key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .navigationDestination(for: Provider.self) { provider in
                CredentialEntryView(provider: provider, onSaved: dismiss)
            }
        }
    }
}

struct CredentialEntryView: View {
    @EnvironmentObject var wallet: WalletStore

    let provider: Provider
    let onSaved: DismissAction

    @State private var label = ""
    @State private var apiKey = ""
    @State private var authMethod: AuthMethod = .apiKey
    @State private var baseUrl = ""
    @State private var error: String?

    private var supportsSetupToken: Bool {
        provider.id == "anthropic"
    }

    private var isLocalProvider: Bool {
        provider.id == "ollama" || provider.id == "lm_studio"
    }

    private var isAzure: Bool { provider.id == "azure_openai" }

    /// Azure, Ollama and LM Studio have no fixed host: the key is only ever
    /// sent to the endpoint stored with it.
    private var requiresEndpoint: Bool { provider.requiresCustomBaseUrl }

    private var normalizedEndpoint: String? {
        Provider.normalizedEndpoint(baseUrl, for: provider.id)
    }

    private var showsEndpointError: Bool {
        requiresEndpoint && !baseUrl.trimmingCharacters(in: .whitespaces).isEmpty && normalizedEndpoint == nil
    }

    private var defaultBaseUrlForProvider: String {
        switch provider.id {
        case "ollama": return "http://localhost:11434"
        case "lm_studio": return "http://localhost:1234"
        default: return ""
        }
    }

    private var isValid: Bool {
        if label.isEmpty { return false }
        if requiresEndpoint && normalizedEndpoint == nil { return false }
        // Local servers may run without auth, so their key is optional.
        return isLocalProvider || !apiKey.isEmpty
    }

    var body: some View {
        Form {
            if supportsSetupToken {
                Section {
                    Picker("Type", selection: $authMethod) {
                        Text("API Key").tag(AuthMethod.apiKey)
                            .accessibilityIdentifier("credentialEntry.authMethod.apiKey")
                        Text("Setup Token").tag(AuthMethod.oauth)
                            .accessibilityIdentifier("credentialEntry.authMethod.setupToken")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("credentialEntry.authMethod")
                } header: {
                    Text("Credential Type")
                }
            }

            if isAzure {
                Section {
                    TextField("https://<resource>.openai.azure.com", text: $baseUrl)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .fontDesign(.monospaced)
                        .accessibilityIdentifier("credentialEntry.endpoint")
                    if showsEndpointError {
                        Text("Use your resource endpoint, like https://contoso.openai.azure.com")
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }
                } header: {
                    Text("Endpoint")
                } footer: {
                    Text("Your Azure OpenAI resource endpoint, from Keys and Endpoint in the Azure portal. This key is only ever sent to this endpoint.")
                }
            }

            if isLocalProvider {
                Section {
                    TextField("http://localhost:11434", text: $baseUrl)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .fontDesign(.monospaced)
                        .accessibilityIdentifier("credentialEntry.baseUrl")
                    if showsEndpointError {
                        Text("Use http://localhost:<port>, http://127.0.0.1:<port>, or an https:// address")
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }
                } header: {
                    Text("Server URL")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(provider.id == "ollama"
                             ? "Where your Ollama server is running. Make sure `ollama serve` is active."
                             : "Where your LM Studio server is running. Start the \"Local Server\" in LM Studio.")
                        Label {
                            Text("The server must be reachable from this device. Apps using this credential fail whenever the server is offline.")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .foregroundStyle(.orange)
                        .padding(.top, 4)
                    }
                }
            }

            Section {
                TextField("Label", text: $label)
                    .textContentType(.name)
                    .accessibilityIdentifier("credentialEntry.label")

                SecureField(
                    authMethod == .oauth ? "Setup Token" : (isLocalProvider ? "API Key (optional)" : "API Key"),
                    text: $apiKey
                )
                .textContentType(.password)
                .fontDesign(.monospaced)
                .accessibilityIdentifier("credentialEntry.apiKey")
            } header: {
                Text("Credential")
            } footer: {
                if authMethod == .oauth {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Run `claude setup-token` in your terminal to get a token.")
                        Text("Setup tokens use your Claude Pro/Max subscription. Requests are sent directly from this device with native networking.")
                    }
                } else if isLocalProvider {
                    Text("Leave blank if your local server has no auth. Any key you enter is stored encrypted in the iOS Keychain and forwarded as a Bearer token.")
                } else {
                    Text("Your key will be encrypted with AES-256-GCM and stored in the iOS Keychain. It never leaves this device.")
                }
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(provider.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { save() }
                    .disabled(!isValid)
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("credentialEntry.save")
            }
        }
        .onAppear {
            label = provider.name
            if isLocalProvider && baseUrl.isEmpty {
                baseUrl = defaultBaseUrlForProvider
            }
        }
    }

    private func save() {
        let cleanKey = apiKey.filter { !$0.isWhitespace && !$0.isNewline }
        let endpoint = normalizedEndpoint
        if requiresEndpoint && endpoint == nil {
            error = WalletError.invalidEndpoint.localizedDescription
            return
        }
        do {
            try wallet.addCredential(
                providerId: provider.id,
                label: label,
                apiKey: cleanKey,
                authMethod: authMethod,
                baseUrl: requiresEndpoint ? endpoint : nil
            )
            onSaved()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
