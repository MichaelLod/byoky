import SwiftUI

/// Add a web app by URL. Only https addresses are accepted; the name is
/// optional and defaults to the site's host. The saved app opens in the
/// in-wallet browser, where it can connect to this wallet.
struct AddAppView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss

    /// Called with the saved app just before the sheet dismisses.
    var onAdded: ((InstalledApp) -> Void)?

    @State private var urlText = ""
    @State private var name = ""
    @State private var error: String?
    @FocusState private var urlFocused: Bool

    private var normalizedURL: URL? { try? InstalledApp.normalizedURL(from: urlText) }

    /// Name the app will get if the name field is left blank.
    private var derivedName: String? {
        normalizedURL.map(InstalledApp.defaultName(for:))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://example.com", text: $urlText)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($urlFocused)
                        .onSubmit(add)
                        .onChange(of: urlText) { _, _ in error = nil }
                        .accessibilityIdentifier("addApp.url")
                } header: {
                    Text("App address")
                } footer: {
                    Text("Only https:// addresses are supported. Opening the app in Byoky's built-in browser connects it to this wallet: it can make AI requests with your keys without ever seeing them. You can disconnect it in Connected Apps.")
                }

                if let url = normalizedURL, InstalledApp.isSharedHosting(url) {
                    Section {
                        Label {
                            Text("\(InstalledApp.origin(of: url)) is shared hosting. Wallet access is per site address, so every page served from it — not just this app — gets the same access.")
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        .font(.callout)
                        .accessibilityIdentifier("addApp.sharedHostingWarning")
                    }
                }

                Section {
                    TextField(derivedName ?? "Name", text: $name)
                        .textInputAutocapitalization(.words)
                        .accessibilityIdentifier("addApp.name")
                } header: {
                    Text("Name (optional)")
                }

                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.callout)
                            .foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("addApp.error")
                    }
                }
            }
            .navigationTitle("Add App")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("addApp.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", action: add)
                        .disabled(urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("addApp.submit")
                }
            }
            .onAppear { urlFocused = true }
        }
    }

    private func add() {
        do {
            let app = try wallet.addApp(urlString: urlText, name: name)
            onAdded?(app)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
