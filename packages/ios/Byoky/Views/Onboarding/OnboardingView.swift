import SwiftUI

private enum OnboardingMode { case vault, byok }
private enum OnboardingStep { case credentials, confirm }

struct OnboardingView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var mode: OnboardingMode = .vault
    @State private var step: OnboardingStep = .credentials
    @State private var isSignup = true
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var error: String?
    @State private var loading = false
    @State private var usernameStatus: VaultUsernameStatus = .idle
    @State private var checkTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            Theme.bgMain.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                if step == .confirm {
                    confirmStep
                } else {
                    credentialsStep
                }

                Spacer()
            }
            .padding(24)
        }
    }

    // MARK: - Credentials Step

    private var credentialsStep: some View {
        VStack(spacing: 20) {
            Text("Byoky")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            Text("One wallet.\nEvery AI app.")
                .font(.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)

            if mode == .vault {
                HStack(spacing: 8) {
                    tabButton("Sign Up", selected: isSignup) {
                        isSignup = true
                        resetFields()
                    }
                    tabButton("Log In", selected: !isSignup) {
                        isSignup = false
                        resetFields()
                    }
                }
            }

            if mode == .byok {
                Text("Create a local password\nto encrypt your API keys.")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }

            VStack(spacing: 12) {
                if mode == .vault {
                    VStack(alignment: .leading, spacing: 4) {
                        TextField("Username", text: $username)
                            .textContentType(.username)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .padding(12)
                            .background(Theme.bgRaised)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Theme.border, lineWidth: 1.5)
                            )
                            .onChange(of: username) { _, newValue in
                                if isSignup { scheduleUsernameCheck(newValue) }
                            }

                        if isSignup && username.count >= 3 {
                            Text(statusMessage)
                                .font(.system(size: 11))
                                .foregroundStyle(statusColor)
                        }
                    }
                }

                SecureField(isSignup ? "Password, 12 characters" : "Password", text: $password)
                    .textContentType(isSignup ? .newPassword : .password)
                    .padding(12)
                    .background(Theme.bgRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Theme.border, lineWidth: 1.5)
                    )

                if isSignup && !password.isEmpty {
                    let quality = PasswordQuality.evaluate(password)
                    HStack(spacing: 6) {
                        Image(systemName: quality.icon)
                        Text(quality.message)
                    }
                    .font(.caption)
                    .foregroundStyle(quality.color)
                }
            }

            Button {
                handleContinue()
            } label: {
                Text(loading ? "Connecting..." : isSignup ? "Continue" : "Log In")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canContinue ? Theme.accent : Theme.accent.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!canContinue)
            .accessibilityIdentifier("onboarding.continue")

            Button {
                withAnimation {
                    mode = (mode == .vault) ? .byok : .vault
                    resetFields()
                    isSignup = true
                }
            } label: {
                Text(mode == .vault ? "Got API keys? Add them here" : "← Back to Vault signup")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
                    .underline()
            }
        }
    }

    // MARK: - Confirm Step

    private var confirmStep: some View {
        VStack(spacing: 20) {
            Text("Byoky")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            Text("Confirm your password")
                .font(.body)
                .foregroundStyle(Theme.textSecondary)

            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }

            SecureField("Repeat your password", text: $confirmPassword)
                .textContentType(.newPassword)
                .padding(12)
                .background(Theme.bgRaised)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Theme.border, lineWidth: 1.5)
                )

            Button {
                handleConfirmSubmit()
            } label: {
                Text(loading ? "Creating..." : "Create Wallet")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(confirmPassword.isEmpty || loading ? Theme.accent.opacity(0.3) : Theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(confirmPassword.isEmpty || loading)
            .accessibilityIdentifier("onboarding.createWallet")

            Button {
                withAnimation {
                    step = .credentials
                    confirmPassword = ""
                    error = nil
                }
            } label: {
                Text("Back")
                    .font(.caption)
                    .foregroundStyle(Theme.textMuted)
                    .underline()
            }
        }
    }

    // MARK: - Helpers

    private func tabButton(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(selected ? .white : Theme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(selected ? Theme.accent : Theme.bgRaised)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var canContinue: Bool {
        if loading { return false }
        if password.count < 12 { return false }
        if isSignup && !PasswordQuality.evaluate(password).isAcceptable { return false }
        if mode == .vault && username.isEmpty { return false }
        if mode == .vault && isSignup && (usernameStatus == .taken || usernameStatus == .invalid) { return false }
        return true
    }

    private func handleContinue() {
        error = nil
        if password.count < 12 {
            error = "Password must be at least 12 characters"
            return
        }
        if isSignup && !PasswordQuality.evaluate(password).isAcceptable {
            error = "Password is too weak"
            return
        }
        if mode == .vault && username.isEmpty {
            error = "Username is required"
            return
        }

        if !isSignup {
            doSubmit()
        } else {
            withAnimation { step = .confirm }
        }
    }

    private func handleConfirmSubmit() {
        error = nil
        if password != confirmPassword {
            error = "Passwords do not match"
            return
        }
        doSubmit()
    }

    private func doSubmit() {
        loading = true
        error = nil
        Task {
            do {
                try wallet.createPassword(password)
                if mode == .vault {
                    let trimmed = username.lowercased().trimmingCharacters(in: .whitespaces)
                    try await wallet.enableCloudVault(username: trimmed, password: password, isSignup: isSignup)
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                }
            }
            await MainActor.run { loading = false }
        }
    }

    private func resetFields() {
        password = ""
        confirmPassword = ""
        username = ""
        error = nil
        usernameStatus = .idle
        step = .credentials
    }

    private var statusMessage: String {
        switch usernameStatus {
        case .checking: return "Checking availability..."
        case .available: return "Username is available"
        case .taken: return "Username is already taken"
        case .invalid: return "Letters, numbers, hyphens, underscores (3-30 chars)"
        case .idle: return ""
        }
    }

    private var statusColor: Color {
        switch usernameStatus {
        case .available: return Color.green
        case .taken, .invalid: return Theme.danger
        default: return Theme.textMuted
        }
    }

    private func scheduleUsernameCheck(_ raw: String) {
        checkTask?.cancel()
        let trimmed = raw.lowercased().trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3 else {
            usernameStatus = .idle
            return
        }
        let pattern = "^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$"
        if trimmed.range(of: pattern, options: .regularExpression) == nil {
            usernameStatus = .invalid
            return
        }
        usernameStatus = .checking
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            if Task.isCancelled { return }
            let result = await wallet.checkUsernameAvailability(trimmed)
            if Task.isCancelled { return }
            await MainActor.run {
                usernameStatus = result.available ? .available : (result.reason == "invalid" ? .invalid : .taken)
            }
        }
    }
}

enum VaultUsernameStatus {
    case idle, checking, available, taken, invalid
}

enum PasswordQuality {
    case tooShort
    case weak(String)
    case fair
    case strong

    var icon: String {
        switch self {
        case .tooShort, .weak: return "exclamationmark.triangle"
        case .fair: return "checkmark.circle"
        case .strong: return "checkmark.shield"
        }
    }

    var message: String {
        switch self {
        case .tooShort: return "Minimum 12 characters"
        case .weak(let reason): return reason
        case .fair: return "Fair — consider adding more variety"
        case .strong: return "Strong password"
        }
    }

    var color: Color {
        switch self {
        case .tooShort, .weak: return .orange
        case .fair: return .yellow
        case .strong: return .green
        }
    }

    var isAcceptable: Bool {
        switch self {
        case .tooShort, .weak: return false
        case .fair, .strong: return true
        }
    }

    static func evaluate(_ password: String) -> PasswordQuality {
        if password.count < 12 { return .tooShort }

        let uniqueChars = Set(password)
        if uniqueChars.count < 4 { return .weak("Too many repeated characters") }

        let hasLower = password.rangeOfCharacter(from: .lowercaseLetters) != nil
        let hasUpper = password.rangeOfCharacter(from: .uppercaseLetters) != nil
        let hasDigit = password.rangeOfCharacter(from: .decimalDigits) != nil
        let hasSymbol = password.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil
        let classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter { $0 }.count

        if classCount < 2 { return .weak("Use a mix of letters, numbers, or symbols") }
        if classCount >= 3 && password.count >= 16 { return .strong }
        return .fair
    }
}
