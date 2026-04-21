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
    @State private var error: String?

    private var supportsSetupToken: Bool {
        provider.id == "anthropic"
    }

    private var isValid: Bool {
        !label.isEmpty && !apiKey.isEmpty
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

            Section {
                TextField("Label", text: $label)
                    .textContentType(.name)
                    .accessibilityIdentifier("credentialEntry.label")

                SecureField(
                    authMethod == .oauth ? "Setup Token" : "API Key",
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
                        Label {
                            Text("Online only — setup tokens require the Byoky app to be open. Apps using this credential will fail if the phone is closed or asleep, even with the cloud vault enabled.")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                        }
                        .foregroundStyle(.orange)
                        .padding(.top, 4)
                    }
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
        }
    }

    private func save() {
        let cleanKey = apiKey.filter { !$0.isWhitespace && !$0.isNewline }
        do {
            try wallet.addCredential(
                providerId: provider.id,
                label: label,
                apiKey: cleanKey,
                authMethod: authMethod
            )
            onSaved()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
