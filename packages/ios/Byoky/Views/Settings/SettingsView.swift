import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showSafariGuide = false

    var body: some View {
        NavigationStack {
            List {
                safariExtensionSection
                securitySection
                aboutSection
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showSafariGuide) {
                SafariExtensionGuide()
            }
        }
    }

    private var safariExtensionSection: some View {
        Section {
            Button {
                showSafariGuide = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "safari")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Safari Extension Setup")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Enable Byoky in Safari to proxy requests")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Text("Safari Extension")
        } footer: {
            Text("The Safari extension lets websites connect to your wallet. You need to enable it once in Safari settings.")
        }
    }

    private var securitySection: some View {
        Section("Security") {
            Button {
                wallet.lock()
            } label: {
                HStack {
                    Label("Lock Wallet", systemImage: "lock")
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .foregroundStyle(.primary)

            LabeledContent("Encryption", value: "AES-256-GCM")
            LabeledContent("Key Derivation", value: "PBKDF2 (600K)")
            LabeledContent("Storage", value: "iOS Keychain")
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version", value: "1.0.0")

            Link(destination: URL(string: "https://github.com/MichaelLod/byoky")!) {
                Label("GitHub", systemImage: "link")
            }

            Link(destination: URL(string: "https://byoky.com")!) {
                Label("Website", systemImage: "globe")
            }
        }
    }
}

struct SafariExtensionGuide: View {
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Enable the Byoky Safari extension to let websites connect to your wallet.")
                        .font(.body)
                        .foregroundStyle(.secondary)

                    guideStep(
                        number: 1,
                        title: "Open Settings",
                        description: "Go to Settings → Safari → Extensions"
                    )

                    guideStep(
                        number: 2,
                        title: "Enable Byoky",
                        description: "Find \"Byoky\" in the list and toggle it on"
                    )

                    guideStep(
                        number: 3,
                        title: "Allow Permissions",
                        description: "Grant permission for \"All Websites\" or specific sites you use"
                    )

                    guideStep(
                        number: 4,
                        title: "Keep the App Open",
                        description: "For OAuth tokens and remote tools, keep the Byoky app in the foreground. The bridge proxy runs as long as the app is active — if you switch away, it pauses and resumes when you return."
                    )

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Important", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                            .foregroundStyle(.orange)

                        Text("API key-based requests work even when the app is in the background. Only OAuth token requests and remote relay connections require the app to stay active.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .padding(16)
                    .background(Color.orange.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(24)
            }
            .navigationTitle("Safari Extension")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func guideStep(number: Int, title: String, description: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.callout.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Theme.accent)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
