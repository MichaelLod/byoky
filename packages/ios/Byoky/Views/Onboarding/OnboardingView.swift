import SwiftUI

enum OnboardingStep {
    case welcome
    case vaultAuth
    case offlineSetup
}

struct OnboardingView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var error: String?
    @State private var step: OnboardingStep = .welcome

    var body: some View {
        ZStack {
            Theme.bgMain.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                switch step {
                case .welcome:
                    welcomeStep
                case .vaultAuth:
                    VaultAuthView(onBack: { withAnimation { step = .welcome } })
                case .offlineSetup:
                    passwordStep
                }

                Spacer()
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private var welcomeStep: some View {
        VStack(spacing: 24) {
            MascotView(size: 140)

            Text("Byoky Wallet")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            Text("Your encrypted wallet for AI API keys. Sync across devices, end-to-end encrypted.")
                .font(.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            Button {
                withAnimation { step = .vaultAuth }
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.top, 8)

            Button {
                withAnimation { step = .offlineSetup }
            } label: {
                Text("Continue in offline mode")
                    .font(.footnote)
                    .foregroundStyle(Theme.textMuted)
            }
        }
    }

    private var passwordStep: some View {
        VStack(spacing: 24) {
            MascotView(size: 100)

            Text("Set Master Password")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Theme.textPrimary)

            Text("This password encrypts all your API keys. It's never stored — only a hash is kept to verify unlock.")
                .font(.callout)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            VStack(spacing: 16) {
                SecureField("Master password", text: $password)
                    .textContentType(.newPassword)
                    .padding(14)
                    .background(Theme.bgRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )

                SecureField("Confirm password", text: $confirmPassword)
                    .textContentType(.newPassword)
                    .padding(14)
                    .background(Theme.bgRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )

                if !password.isEmpty {
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
                createWallet()
            } label: {
                Text("Create Wallet")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(isValid ? Theme.accent : Theme.accent.opacity(0.3))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!isValid)

            Button {
                withAnimation { step = .welcome }
            } label: {
                Text("Back")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var isValid: Bool {
        password == confirmPassword && PasswordQuality.evaluate(password).isAcceptable
    }

    private func createWallet() {
        do {
            try wallet.createPassword(password)
        } catch {
            self.error = error.localizedDescription
        }
    }
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
