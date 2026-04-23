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

    private var defaultBaseUrlForProvider: String {
        switch provider.id {
        case "ollama": return "http://localhost:11434"
        case "lm_studio": return "http://localhost:1234"
        default: return ""
        }
    }

    private var isValid: Bool {
        if label.isEmpty { return false }
        if isLocalProvider {
            // Local providers can have an empty API key (unauthenticated
            // server) but require a baseUrl.
            return !baseUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return !apiKey.isEmpty
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

            if isLocalProvider {
                Section {
                    TextField("http://localhost:11434", text: $baseUrl)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .fontDesign(.monospaced)
                        .accessibilityIdentifier("credentialEntry.baseUrl")
                } header: {
                    Text("Server URL")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(provider.id == "ollama"
                             ? "Where your Ollama server is running. Make sure `ollama serve` is active."
                             : "Where your LM Studio server is running. Start the \"Local Server\" in LM Studio.")
                        Label {
                            Text("Your computer must stay online. This credential only works while your machine is running. Gift recipients will see it as offline whenever your machine sleeps or disconnects.")
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
                        Text("Setup tokens use your Claude Pro/Max subscription. API requests route through the app with native networking.")
                        if wallet.cloudVaultEnabled {
                            Label {
                                Text("Cloud Sync enabled — setup-token requests are served by Byoky's residential-proxy gateway when your phone is closed or asleep.")
                            } icon: {
                                Image(systemName: "cloud.fill")
                            }
                            .foregroundStyle(Theme.accent)
                            .padding(.top, 4)
                        } else {
                            Label {
                                Text("Online only — without Cloud Sync, setup tokens require the Byoky app to be open. Apps using this credential will fail if the phone is closed or asleep.")
                            } icon: {
                                Image(systemName: "exclamationmark.triangle.fill")
                            }
                            .foregroundStyle(.orange)
                            .padding(.top, 4)
                        }
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
        let trimmedBase = baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        do {
            try wallet.addCredential(
                providerId: provider.id,
                label: label,
                apiKey: cleanKey,
                authMethod: authMethod,
                baseUrl: isLocalProvider ? trimmedBase : nil
            )
            onSaved()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
