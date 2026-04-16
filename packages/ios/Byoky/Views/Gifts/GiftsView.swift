import SwiftUI

struct GiftsView: View {
    @EnvironmentObject var wallet: WalletStore

    private var activeGifts: [Gift] {
        wallet.gifts.filter { $0.active && !isGiftExpired($0) }
    }

    private var inactiveGifts: [Gift] {
        wallet.gifts.filter { !$0.active || isGiftExpired($0) }
    }

    /// Active received gifts now live inline on the Wallet screen alongside
    /// owned credentials. Only expired/revoked received gifts stay here so
    /// the user can prune them.
    private var expiredReceived: [GiftedCredential] {
        wallet.giftedCredentials.filter { isGiftedCredentialExpired($0) }
    }

    private var hasAnyItems: Bool {
        !wallet.gifts.isEmpty || !expiredReceived.isEmpty
    }

    private var hasCredentials: Bool {
        !wallet.credentials.isEmpty
    }

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if hasAnyItems {
                    List {
                        actionsSection
                        if !activeGifts.isEmpty {
                            sentSection
                        }
                        if !inactiveGifts.isEmpty || !expiredReceived.isEmpty {
                            expiredSection
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(Theme.bgMain)
                } else {
                    emptyState
                }
            }
            .background(Theme.bgMain)
            .toolbarBackground(Theme.bgMain, for: .navigationBar)
            .navigationTitle("Gifts")
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "gift.fill")
                .font(.system(size: 40))
                .foregroundStyle(Color(.systemGray3))

            Text("No Gifts")
                .font(.headline)

            Text(hasCredentials
                 ? "Share token access without sharing your API keys. Create a gift link or redeem one you received."
                 : "Add a credential before you can create a gift. You can still redeem gifts you've received.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            HStack(spacing: 12) {
                NavigationLink {
                    CreateGiftView()
                } label: {
                    Label("Create Gift", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(!hasCredentials)
                .accessibilityIdentifier("gifts.createGift")

                NavigationLink {
                    RedeemGiftView()
                } label: {
                    Label("Redeem Gift", systemImage: "arrow.down.circle")
                }
                .buttonStyle(.bordered)
                .tint(Theme.accent)
                .accessibilityIdentifier("gifts.redeemGift")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var actionsSection: some View {
        Section {
            NavigationLink {
                CreateGiftView()
            } label: {
                Label("Create Gift", systemImage: "plus.circle.fill")
                    .foregroundStyle(hasCredentials ? Theme.accent : Color(.systemGray3))
            }
            .disabled(!hasCredentials)
            .accessibilityIdentifier("gifts.createGift")

            if !hasCredentials {
                Text("Add a credential before you can create a gift.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            NavigationLink {
                RedeemGiftView()
            } label: {
                Label("Redeem Gift", systemImage: "arrow.down.circle.fill")
                    .foregroundStyle(Theme.accent)
            }
            .accessibilityIdentifier("gifts.redeemGift")
        }
    }

    private var sentSection: some View {
        Section {
            ForEach(activeGifts) { gift in
                SentGiftRow(gift: gift)
            }
        } header: {
            Text("Sent")
        }
    }

    private var expiredSection: some View {
        Section {
            ForEach(inactiveGifts) { gift in
                SentGiftRow(gift: gift)
                    .opacity(0.5)
            }
            ForEach(expiredReceived) { credential in
                ReceivedGiftRow(credential: credential)
                    .opacity(0.5)
            }
            .onDelete { offsets in
                let items = expiredReceived
                for index in offsets {
                    wallet.removeGiftedCredential(id: items[index].id)
                }
            }
        } header: {
            Text("Expired / Revoked")
        }
    }
}

// MARK: - Sent Gift Row

struct SentGiftRow: View {
    @EnvironmentObject var wallet: WalletStore
    let gift: Gift

    private var providerName: String {
        Provider.find(gift.providerId)?.name ?? gift.providerId
    }


    private var remaining: Int {
        giftBudgetRemaining(gift)
    }

    private var percent: Double {
        giftBudgetPercent(gift)
    }

    private var expiryText: String {
        if isGiftExpired(gift) { return "Expired" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return "Expires " + formatter.localizedString(for: gift.expiresAt, relativeTo: Date())
    }

    private var shareUrl: URL? {
        let (encoded, _) = createGiftLink(from: gift)
        return URL(string: giftLinkToUrl(encoded))
    }

    private var shareText: String {
        "I'm sharing \(formatTokenCount(gift.maxTokens)) tokens of \(providerName) via Byoky!"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ProviderIcon(providerId: gift.providerId, size: 16)
                    .foregroundStyle(Color.white)
                    .frame(width: 32, height: 32)
                    .background(Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 2) {
                    Text(gift.label)
                        .font(.body.weight(.medium))
                    Text(providerName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if gift.active && !isGiftExpired(gift) {
                    HStack(spacing: 8) {
                        if let url = shareUrl {
                            ShareLink(
                                item: url,
                                subject: Text("Byoky Gift"),
                                message: Text(shareText)
                            ) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 14))
                                    .foregroundStyle(Theme.accent)
                            }
                            .buttonStyle(.borderless)
                        }

                        Button {
                            wallet.revokeGift(id: gift.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.borderless)
                    }
                }
            }

            ProgressView(value: percent)
                .tint(percent > 0.9 ? .red : Theme.accent)

            HStack {
                Text("\(formatTokenCount(remaining)) / \(formatTokenCount(gift.maxTokens)) remaining")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(expiryText)
                    .font(.caption2)
                    .foregroundStyle(isGiftExpired(gift) ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Received Gift Row

struct ReceivedGiftRow: View {
    @EnvironmentObject var wallet: WalletStore
    let credential: GiftedCredential

    private var hasOwnKey: Bool {
        wallet.credentials.contains { $0.providerId == credential.providerId }
    }

    private var isPreferred: Bool {
        wallet.giftPreferences[credential.providerId] == credential.giftId
    }

    private var remaining: Int {
        giftedBudgetRemaining(credential)
    }

    private var percent: Double {
        giftedBudgetPercent(credential)
    }

    private var expiryText: String {
        if isGiftedCredentialExpired(credential) { return "Expired" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return "Expires " + formatter.localizedString(for: credential.expiresAt, relativeTo: Date())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: "gift.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 32, height: 32)
                    .background(Theme.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 2) {
                    Text(credential.senderLabel)
                        .font(.body.weight(.medium))
                    Text("from \(credential.providerName)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            ProgressView(value: percent)
                .tint(percent > 0.9 ? .red : Theme.accent)

            HStack {
                Text("\(formatTokenCount(remaining)) / \(formatTokenCount(credential.maxTokens)) remaining")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(expiryText)
                    .font(.caption2)
                    .foregroundStyle(isGiftedCredentialExpired(credential) ? .red : .secondary)
            }

            if hasOwnKey && !isGiftedCredentialExpired(credential) {
                Toggle("Use instead of own key", isOn: Binding(
                    get: { isPreferred },
                    set: { wallet.setGiftPreference(providerId: credential.providerId, giftId: $0 ? credential.giftId : nil) }
                ))
                .font(.caption)
                .tint(Theme.accent)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Helpers

private func formatTokenCount(_ n: Int) -> String {
    if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
    if n >= 1_000 { return String(format: "%.1fK", Double(n) / 1_000) }
    return "\(n)"
}
