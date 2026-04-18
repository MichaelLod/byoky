import SwiftUI

struct RedeemGiftView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    /// Optional pre-filled link — used when the sheet is opened from a
    /// `byoky://gift/<payload>` deep link so the user doesn't have to paste.
    let prefilledLink: String?

    @State private var linkText = ""
    @State private var previewLink: GiftLink?
    @State private var validationError: String?
    @State private var redeemError: String?
    @State private var redeemed = false
    @State private var showScanner = false

    init(prefilledLink: String? = nil) {
        self.prefilledLink = prefilledLink
    }

    var body: some View {
        Form {
            Section {
                Button {
                    showScanner = true
                } label: {
                    HStack {
                        Spacer()
                        Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .tint(Theme.accent)
                .accessibilityIdentifier("redeemGift.scan")
            }

            Section {
                TextEditor(text: $linkText)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 80)
                    .onChange(of: linkText) { _ in
                        parseLink()
                    }
                    .accessibilityIdentifier("redeemGift.link")
            } header: {
                Text("Gift Link")
            } footer: {
                Text("Paste the gift link or scan the QR code from the token pool.")
            }

            if let link = previewLink {
                Section {
                    previewRow(label: "Provider", value: link.n)
                    previewRow(label: "From", value: link.s)
                    previewRow(label: "Budget", value: formatTokenCount(link.m))

                    let expiresAt = Date(timeIntervalSince1970: link.e / 1000)
                    previewRow(label: "Expires", value: formatExpiry(expiresAt))
                } header: {
                    Text("Preview")
                }
            }

            if let validationError {
                Section {
                    Label(validationError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if let redeemError {
                Section {
                    Label(redeemError, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }

            if redeemed {
                Section {
                    Label("Gift accepted!", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(Theme.success)
                }
            }

            Section {
                Button {
                    redeem()
                } label: {
                    HStack {
                        Spacer()
                        Label("Accept Gift", systemImage: "gift.fill")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(previewLink == nil || redeemed)
                .tint(Theme.accent)
                .accessibilityIdentifier("redeemGift.accept")
            }
        }
        .navigationTitle("Redeem Gift")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showScanner) {
            QRScannerView { code in
                showScanner = false
                linkText = code
                parseLink()
            }
        }
        .onAppear {
            if let prefilled = prefilledLink, linkText.isEmpty {
                linkText = prefilled
                parseLink()
            }
        }
    }

    private func previewRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
    }

    private func parseLink() {
        previewLink = nil
        validationError = nil
        redeemError = nil
        redeemed = false

        var encoded = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        if encoded.isEmpty { return }

        if encoded.hasPrefix("https://byoky.com/gift#") {
            encoded = String(encoded.dropFirst("https://byoky.com/gift#".count))
        } else if encoded.hasPrefix("https://byoky.com/gift/") {
            encoded = String(encoded.dropFirst("https://byoky.com/gift/".count))
        } else if encoded.hasPrefix("byoky://gift/") {
            encoded = String(encoded.dropFirst("byoky://gift/".count))
        }

        do {
            let link = try decodeGiftLink(encoded)
            try validateGiftLink(link)
            previewLink = link
        } catch {
            validationError = error.localizedDescription
        }
    }

    private func redeem() {
        var encoded = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        if encoded.hasPrefix("https://byoky.com/gift#") {
            encoded = String(encoded.dropFirst("https://byoky.com/gift#".count))
        } else if encoded.hasPrefix("https://byoky.com/gift/") {
            encoded = String(encoded.dropFirst("https://byoky.com/gift/".count))
        } else if encoded.hasPrefix("byoky://gift/") {
            encoded = String(encoded.dropFirst("byoky://gift/".count))
        }

        do {
            try wallet.redeemGift(encoded: encoded)
            redeemed = true
            redeemError = nil

            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                dismiss()
            }
        } catch {
            redeemError = error.localizedDescription
        }
    }

    private func formatTokenCount(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
        return "\(n)"
    }

    private func formatExpiry(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
