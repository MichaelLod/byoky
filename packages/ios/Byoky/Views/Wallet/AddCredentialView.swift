import SwiftUI

struct AddCredentialView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var selectedProvider: Provider?
    @State private var label = ""
    @State private var apiKey = ""
    @State private var authMethod: AuthMethod = .apiKey
    @State private var error: String?

    private var supportsSetupToken: Bool {
        selectedProvider?.id == "anthropic"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    providerPicker
                } header: {
                    Text("Provider")
                } footer: {
                    Text("Select the AI provider for this credential.")
                }

                if selectedProvider != nil {
                    if supportsSetupToken {
                        Section {
                            Picker("Type", selection: $authMethod) {
                                Text("API Key").tag(AuthMethod.apiKey)
                                Text("Setup Token").tag(AuthMethod.oauth)
                            }
                            .pickerStyle(.segmented)
                        } header: {
                            Text("Credential Type")
                        }
                    }

                    Section {
                        TextField("Label", text: $label)
                            .textContentType(.name)

                        SecureField(
                            authMethod == .oauth ? "Setup Token" : "API Key",
                            text: $apiKey
                        )
                        .textContentType(.password)
                        .fontDesign(.monospaced)
                    } header: {
                        Text("Credential")
                    } footer: {
                        if authMethod == .oauth {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Run `claude setup-token` in your terminal to get a token.")
                                Text("Setup tokens use your Claude Pro/Max subscription. API requests route through the app with native networking.")
                            }
                        } else {
                            Text("Your key will be encrypted with AES-256-GCM and stored in the iOS Keychain. It never leaves this device.")
                        }
                    }
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(authMethod == .oauth ? "Add Setup Token" : "Add API Key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!isValid)
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private var providerPicker: some View {
        ForEach(Provider.all) { provider in
            Button {
                selectedProvider = provider
                if label.isEmpty {
                    label = provider.name
                }
                // Reset to API key when switching providers
                if provider.id != "anthropic" {
                    authMethod = .apiKey
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: provider.icon)
                        .font(.system(size: 16))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32, height: 32)
                        .background(Theme.accent.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))

                    Text(provider.name)
                        .foregroundStyle(.primary)

                    Spacer()

                    if selectedProvider?.id == provider.id {
                        Image(systemName: "checkmark")
                            .foregroundStyle(Theme.accent)
                            .fontWeight(.semibold)
                    }
                }
            }
        }
    }

    private var isValid: Bool {
        selectedProvider != nil && !label.isEmpty && !apiKey.isEmpty
    }

    private func save() {
        guard let provider = selectedProvider else { return }
        do {
            try wallet.addCredential(
                providerId: provider.id,
                label: label,
                apiKey: apiKey,
                authMethod: authMethod
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
