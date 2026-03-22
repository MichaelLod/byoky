import SwiftUI

struct AddCredentialView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var selectedProvider: Provider?
    @State private var label = ""
    @State private var apiKey = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    providerPicker
                } header: {
                    Text("Provider")
                } footer: {
                    Text("Select the AI provider for this API key.")
                }

                if selectedProvider != nil {
                    Section {
                        TextField("Label", text: $label)
                            .textContentType(.name)

                        SecureField("API Key", text: $apiKey)
                            .textContentType(.password)
                            .fontDesign(.monospaced)
                    } header: {
                        Text("Credential")
                    } footer: {
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
            .navigationTitle("Add API Key")
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
                apiKey: apiKey
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
