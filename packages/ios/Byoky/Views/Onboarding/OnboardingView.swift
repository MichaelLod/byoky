import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var error: String?
    @State private var step = 0

    var body: some View {
        ZStack {
            Theme.bgMain.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                if step == 0 {
                    welcomeStep
                } else {
                    passwordStep
                }

                Spacer()

                HStack(spacing: 8) {
                    Circle()
                        .fill(step == 0 ? Theme.accent : Theme.textMuted)
                        .frame(width: 8, height: 8)
                    Circle()
                        .fill(step == 1 ? Theme.accent : Theme.textMuted)
                        .frame(width: 8, height: 8)
                }
                .padding(.bottom, 32)
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

            Text("Your AI API keys, encrypted and always with you. Apps connect through the wallet — keys never leave your device.")
                .font(.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)

            VStack(alignment: .leading, spacing: 12) {
                featureRow(icon: "lock.shield", text: "AES-256-GCM encryption with Keychain")
                featureRow(icon: "eye.slash", text: "Keys never exposed to apps")
                featureRow(icon: "safari", text: "Works with any website via Safari extension")
                featureRow(icon: "antenna.radiowaves.left.and.right", text: "Bridge proxy for OAuth and remote tools")
            }
            .padding(.top, 8)

            Button {
                withAnimation { step = 1 }
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
                withAnimation { step = 0 }
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

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(Theme.accent)
                .frame(width: 24)
            Text(text)
                .font(.callout)
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

private enum PasswordQuality {
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
