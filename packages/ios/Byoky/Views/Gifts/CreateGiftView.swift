import SwiftUI

struct CreateGiftView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var selectedCredential: Credential?
    @State private var maxTokens: Int = 100_000
    @State private var customTokens = ""
    @State private var useCustomTokens = false
    @State private var expiryOption: ExpiryOption = .days7
    @State private var listPublicly = false
    @State private var descriptionText = ""
    @State private var createdGift: Gift?
    @State private var shortId: String?
    @State private var error: String?

    private let tokenPresets = [10_000, 50_000, 100_000, 500_000, 1_000_000]
    private static let relayUrl = "wss://relay.byoky.com"

    private var effectiveTokens: Int {
        if useCustomTokens, let custom = Int(customTokens), custom > 0 {
            return custom
        }
        return maxTokens
    }

    private var isValid: Bool {
        selectedCredential != nil && effectiveTokens > 0
    }

    var body: some View {
        SwiftUI.Group {
            if wallet.credentials.isEmpty {
                noCredentialsView
            } else if let gift = createdGift {
                giftCreatedView(gift: gift)
            } else {
                formView
            }
        }
        .navigationTitle("Create Gift")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Default to the first credential so the Create button isn't
            // silently disabled. Without this the user sees an empty list
            // with no checkmark and wonders why Create is greyed out.
            if selectedCredential == nil {
                selectedCredential = wallet.credentials.first
            }
        }
    }

    private var noCredentialsView: some View {
        VStack(spacing: 16) {
            Image(systemName: "key.slash")
                .font(.system(size: 40))
                .foregroundStyle(Color(.systemGray3))

            Text("No Credentials")
                .font(.headline)

            Text("Add a credential first before you can gift tokens. Open the Wallet tab and tap the + button to add one.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                dismiss()
            } label: {
                Text("Go back")
                    .fontWeight(.semibold)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.accent)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var formView: some View {
        Form {
            Section {
                ForEach(wallet.credentials) { credential in
                    Button {
                        selectedCredential = credential
                    } label: {
                        HStack(spacing: 12) {
                            ProviderIcon(providerId: credential.providerId, size: 16)
                                .foregroundStyle(Color.white)
                                .frame(width: 32, height: 32)
                                .background(Color.black)
                                .clipShape(RoundedRectangle(cornerRadius: 6))

                            VStack(alignment: .leading, spacing: 2) {
                                Text(credential.label)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(.primary)
                                Text(Provider.find(credential.providerId)?.name ?? credential.providerId)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            if selectedCredential?.id == credential.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                    }
                    .accessibilityIdentifier("createGift.credential.\(credential.id)")
                }
            } header: {
                Text("Credential")
            } footer: {
                Text("Select which API key to share access to.")
            }

            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tokenPresets, id: \.self) { preset in
                            Button {
                                useCustomTokens = false
                                maxTokens = preset
                            } label: {
                                Text(formatPreset(preset))
                                    .font(.subheadline.weight(.medium))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(!useCustomTokens && maxTokens == preset ? Theme.accent : Color(.systemGray5))
                                    .foregroundStyle(!useCustomTokens && maxTokens == preset ? .white : .primary)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }

                        Button {
                            useCustomTokens = true
                        } label: {
                            Text("Custom")
                                .font(.subheadline.weight(.medium))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(useCustomTokens ? Theme.accent : Color(.systemGray5))
                                .foregroundStyle(useCustomTokens ? .white : .primary)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("createGift.customToggle")
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))

                if useCustomTokens {
                    TextField("Token budget", text: $customTokens)
                        .keyboardType(.numberPad)
                        .accessibilityIdentifier("createGift.customTokens")
                }
            } header: {
                Text("Token Budget")
            }

            Section {
                Picker("Expiry", selection: $expiryOption) {
                    ForEach(ExpiryOption.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
            } header: {
                Text("Expiry")
            }

            Section {
                Toggle("List on Token Pool", isOn: $listPublicly)
                    .tint(Theme.accent)
                if listPublicly {
                    TextField("Description (optional)", text: $descriptionText, axis: .vertical)
                        .lineLimit(2...4)
                }
            } header: {
                Text("Token Pool")
            } footer: {
                Text("Make this gift public on byoky.com/token-pool. Your account username shows as the gifter.")
            }

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if !wallet.cloudVaultEnabled {
                Section {
                    Label("Your device must stay online for the recipient to use this gift. Enable Cloud Sync in Settings for offline access.", systemImage: "wifi")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } header: {
                    Text("Note")
                }
            }

            Section {
                Button {
                    createGift()
                } label: {
                    HStack {
                        Spacer()
                        Label("Create Gift", systemImage: "gift.fill")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(!isValid)
                .tint(Theme.accent)
                .accessibilityIdentifier("createGift.submit")
            }
        }
    }

    private func giftCreatedView(gift: Gift) -> some View {
        let (encoded, _) = createGiftLink(from: gift)
        // Prefer the short URL once the vault has handed one back. Until then
        // (and if the vault is unreachable / user isn't signed in) we keep
        // showing the long URL so the UI is never empty.
        let urlString = shortId.map { giftShortLinkToUrl($0) } ?? giftLinkToUrl(encoded)
        let providerName = Provider.find(gift.providerId)?.name ?? gift.providerId
        let shareText = "I'm sharing \(formatPreset(gift.maxTokens)) tokens of \(providerName) via Byoky!"

        return ScrollView {
            VStack(spacing: 24) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Theme.success)

                Text("Gift Created")
                    .font(.title2.weight(.bold))

                Text("Share this link with the recipient. They can redeem it in their Byoky app.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                VStack(spacing: 12) {
                    Text(urlString)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .frame(maxWidth: .infinity)
                        .background(Color(.secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .accessibilityIdentifier("createGift.link")

                    HStack(spacing: 12) {
                        if let url = URL(string: urlString) {
                            ShareLink(
                                item: url,
                                subject: Text("Byoky Gift"),
                                message: Text(shareText)
                            ) {
                                Label("Share", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Theme.accent)
                        }

                        Button {
                            UIPasteboard.general.string = urlString
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(Theme.accent)
                    }
                }
                .padding(.horizontal, 16)

                Button("Done") {
                    dismiss()
                }
                .padding(.top, 8)
                .accessibilityIdentifier("createGift.done")
            }
            .padding(.top, 40)
            .padding()
        }
    }

    private func createGift() {
        guard let credential = selectedCredential else {
            error = "Select a credential"
            return
        }

        let gift = wallet.createGift(
            credentialId: credential.id,
            providerId: credential.providerId,
            label: credential.label,
            maxTokens: effectiveTokens,
            expiresInMs: expiryOption.milliseconds,
            relayUrl: Self.relayUrl,
            listPublicly: listPublicly,
            description: listPublicly ? (descriptionText.isEmpty ? nil : descriptionText) : nil
        )
        createdGift = gift
        shortId = nil
        error = nil

        // Allocate a short link in the background. Silent fallback to the
        // long URL if the user isn't signed into the cloud vault or the
        // request fails. The short id also gets pushed back to the vault so
        // /pool can surface it for redemption.
        let (encoded, _) = createGiftLink(from: gift)
        Task { @MainActor in
            let allocated = await wallet.createGiftShortLink(encoded: encoded, expiresAt: gift.expiresAt)
            if let allocated {
                self.shortId = allocated
                wallet.setGiftShortId(giftId: gift.id, shortId: allocated)
            }
        }
    }

    private func formatPreset(_ n: Int) -> String {
        if n >= 1_000_000 { return "\(n / 1_000_000)M" }
        if n >= 1_000 { return "\(n / 1_000)K" }
        return "\(n)"
    }
}

enum ExpiryOption: String, CaseIterable, Identifiable {
    case hour1 = "1h"
    case hours24 = "24h"
    case days7 = "7d"
    case days30 = "30d"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .hour1: return "1 hour"
        case .hours24: return "24 hours"
        case .days7: return "7 days"
        case .days30: return "30 days"
        }
    }

    var milliseconds: TimeInterval {
        switch self {
        case .hour1: return 3_600_000
        case .hours24: return 86_400_000
        case .days7: return 604_800_000
        case .days30: return 2_592_000_000
        }
    }
}
