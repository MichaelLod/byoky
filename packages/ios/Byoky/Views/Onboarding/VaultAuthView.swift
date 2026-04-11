import SwiftUI

enum VaultUsernameStatus {
    case idle
    case checking
    case available
    case taken
    case invalid
}

struct VaultAuthView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var username = ""
    @State private var password = ""
    @State private var status: VaultUsernameStatus = .idle
    @State private var error: String?
    @State private var loading = false
    @State private var checkTask: Task<Void, Never>?

    let onBack: () -> Void

    private var mode: AuthMode {
        switch status {
        case .available: return .signup
        case .taken: return .login
        default: return .unknown
        }
    }

    private var buttonLabel: String {
        if loading { return "Connecting..." }
        if status == .checking { return "Checking username..." }
        switch mode {
        case .signup: return "Create account"
        case .login: return "Sign in"
        case .unknown: return "Continue"
        }
    }

    private var canSubmit: Bool {
        guard !loading, username.count >= 3, !password.isEmpty else { return false }
        if mode == .signup {
            return password.count >= 12 && PasswordQuality.evaluate(password).isAcceptable
        }
        return mode == .login
    }

    var body: some View {
        VStack(spacing: 20) {
            MascotView(size: 100)

            Text("Your vault, your keys")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            Text("End-to-end encrypted with your password. We can't read your keys.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Choose or enter your username", text: $username)
                        .textContentType(.username)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .padding(14)
                        .background(Theme.bgRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.06), lineWidth: 1)
                        )
                        .onChange(of: username) { _, newValue in
                            scheduleUsernameCheck(newValue)
                        }

                    if username.count >= 3 {
                        Text(statusMessage)
                            .font(.caption2)
                            .foregroundStyle(statusColor)
                    }
                }

                SecureField(mode == .login ? "Your password" : "At least 12 characters", text: $password)
                    .textContentType(mode == .login ? .password : .newPassword)
                    .padding(14)
                    .background(Theme.bgRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )

                if mode == .signup && !password.isEmpty {
                    let quality = PasswordQuality.evaluate(password)
                    HStack(spacing: 6) {
                        Image(systemName: quality.icon)
                        Text(quality.message)
                    }
                    .font(.caption)
                    .foregroundStyle(quality.color)
                }

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Theme.danger)
                }
            }

            Button {
                Task { await submit() }
            } label: {
                Text(buttonLabel)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canSubmit ? Theme.accent : Theme.accent.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!canSubmit)

            Button(action: onBack) {
                Text("← Back")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var statusMessage: String {
        switch status {
        case .checking: return "Checking..."
        case .available: return "Available — creating a new account"
        case .taken: return "Existing account — signing in"
        case .invalid: return "Letters, numbers, hyphens, underscores only (3-30 chars)"
        case .idle: return ""
        }
    }

    private var statusColor: Color {
        switch status {
        case .available: return Color.green
        case .invalid: return Theme.danger
        default: return Theme.textMuted
        }
    }

    private func scheduleUsernameCheck(_ raw: String) {
        error = nil
        checkTask?.cancel()
        let trimmed = raw.lowercased().trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3 else {
            status = .idle
            return
        }
        let pattern = "^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$"
        if trimmed.range(of: pattern, options: .regularExpression) == nil {
            status = .invalid
            return
        }
        status = .checking
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            if Task.isCancelled { return }
            let result = await wallet.checkUsernameAvailability(trimmed)
            if Task.isCancelled { return }
            await MainActor.run {
                if result.available {
                    status = .available
                } else {
                    status = (result.reason == "invalid") ? .invalid : .taken
                }
            }
        }
    }

    private func submit() async {
        guard canSubmit else { return }
        error = nil
        loading = true
        defer { loading = false }
        let trimmed = username.lowercased().trimmingCharacters(in: .whitespaces)
        do {
            switch mode {
            case .signup:
                try await wallet.vaultBootstrapSignup(username: trimmed, password: password)
            case .login:
                try await wallet.vaultBootstrapLogin(username: trimmed, password: password)
            case .unknown:
                return
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private enum AuthMode {
    case signup
    case login
    case unknown
}
