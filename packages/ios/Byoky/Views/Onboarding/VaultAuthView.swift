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
    @State private var mode: AuthMode

    let onBack: () -> Void

    init(initialMode: AuthMode, onBack: @escaping () -> Void) {
        _mode = State(initialValue: initialMode)
        self.onBack = onBack
    }

    private var buttonLabel: String {
        if loading { return "Connecting..." }
        if status == .checking { return "Checking username..." }
        switch mode {
        case .signup: return "Create account"
        case .login: return "Sign in"
        }
    }

    private var canSubmit: Bool {
        guard !loading, username.count >= 3, !password.isEmpty else { return false }
        switch mode {
        case .signup:
            guard status == .available else { return false }
            return password.count >= 12 && PasswordQuality.evaluate(password).isAcceptable
        case .login:
            return status == .taken
        }
    }

    var body: some View {
        VStack(spacing: 20) {
            MascotView(size: 100)

            Text("Your vault, your keys")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            HStack(spacing: 4) {
                modeTab(.signup, title: "Create account")
                modeTab(.login, title: "Sign in")
            }
            .padding(4)
            .background(Theme.bgRaised)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            Text(mode == .login
                ? "Sign in to sync keys from your vault."
                : "End-to-end encrypted with your password. We can't read your keys.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            VStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    TextField(mode == .login ? "Your username" : "Choose a username", text: $username)
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
                        usernameStatusHint
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

    @ViewBuilder
    private func modeTab(_ target: AuthMode, title: String) -> some View {
        let selected = mode == target
        Button {
            mode = target
            error = nil
        } label: {
            Text(title)
                .font(.system(size: 13, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? Theme.textPrimary : Theme.textMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(selected ? Theme.bgCard : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var usernameStatusHint: some View {
        switch (mode, status) {
        case (_, .checking):
            Text("Checking...")
                .font(.caption2)
                .foregroundStyle(Theme.textMuted)
        case (_, .invalid):
            Text("Letters, numbers, hyphens, underscores only (3-30 chars)")
                .font(.caption2)
                .foregroundStyle(Theme.danger)
        case (.signup, .available):
            Text("Available")
                .font(.caption2)
                .foregroundStyle(Color.green)
        case (.login, .taken):
            Text("Account found")
                .font(.caption2)
                .foregroundStyle(Color.green)
        case (.signup, .taken):
            HStack(spacing: 4) {
                Text("Already taken.")
                    .foregroundStyle(Theme.danger)
                Button("Sign in instead") { mode = .login }
                    .foregroundStyle(Theme.accent)
            }
            .font(.caption2)
        case (.login, .available):
            HStack(spacing: 4) {
                Text("No account with this username.")
                    .foregroundStyle(Theme.danger)
                Button("Create one") { mode = .signup }
                    .foregroundStyle(Theme.accent)
            }
            .font(.caption2)
        case (_, .idle):
            EmptyView()
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
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

enum AuthMode {
    case signup
    case login
}
