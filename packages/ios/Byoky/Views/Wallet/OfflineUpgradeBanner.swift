import SwiftUI

private let dismissCooldown: TimeInterval = 7 * 24 * 3600

struct OfflineUpgradeBanner: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var expanded = false
    @State private var username = ""
    @State private var password = ""
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        if shouldShow {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sync across devices")
                            .font(.subheadline.bold())
                            .foregroundStyle(Theme.textPrimary)
                        Text("Activate your vault to access your keys on any device, end-to-end encrypted.")
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

                if !expanded {
                    Button {
                        expanded = true
                    } label: {
                        Text("Activate vault")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                } else {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .padding(10)
                        .background(Theme.bgRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    SecureField("Your password", text: $password)
                        .textContentType(.password)
                        .padding(10)
                        .background(Theme.bgRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    if let error {
                        Text(error)
                            .font(.caption2)
                            .foregroundStyle(Theme.danger)
                    }

                    HStack(spacing: 8) {
                        Button {
                            Task { await activate() }
                        } label: {
                            Text(loading ? "Activating..." : "Activate")
                                .font(.caption.bold())
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background((username.isEmpty || password.isEmpty || loading) ? Theme.accent.opacity(0.3) : Theme.accent)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .disabled(username.isEmpty || password.isEmpty || loading)

                        Button {
                            expanded = false
                            username = ""
                            password = ""
                            error = nil
                        } label: {
                            Text("Cancel")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                        }
                    }
                }
            }
            .padding(12)
            .background(Theme.accent.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Theme.accent, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
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

    private func activate() async {
        let trimmed = username.lowercased().trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !password.isEmpty else { return }
        loading = true
        defer { loading = false }
        do {
            try await wallet.vaultActivate(username: trimmed, password: password)
            expanded = false
            username = ""
            password = ""
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
