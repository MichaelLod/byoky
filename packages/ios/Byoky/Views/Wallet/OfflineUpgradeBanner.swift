import SwiftUI

private let dismissCooldown: TimeInterval = 7 * 24 * 3600

struct OfflineUpgradeBanner: View {
    @EnvironmentObject var wallet: WalletStore
    let onActivate: () -> Void

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sync across devices")
                            .font(.subheadline.bold())
                            .foregroundStyle(Theme.textPrimary)
                        Text("Turn on Cloud Sync to access your keys on any device, end-to-end encrypted.")
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Button {
                        wallet.dismissVaultBanner()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption)
                            .foregroundStyle(Theme.textMuted)
                    }
                }

                Button {
                    onActivate()
                } label: {
                    Text("Activate Cloud Sync")
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Theme.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
            .padding(12)
            .background(Theme.accent.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .strokeBorder(Theme.accent, lineWidth: 1)
            )
            .padding(.bottom, 12)
        }
    }

    private var shouldShow: Bool {
        if wallet.cloudVaultEnabled { return false }
        if let dismissed = wallet.vaultBannerDismissedAt, Date().timeIntervalSince(dismissed) < dismissCooldown {
            return false
        }
        return true
    }
}
