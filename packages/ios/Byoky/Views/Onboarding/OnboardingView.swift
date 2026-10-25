import SwiftUI

enum OnboardingStep {
    case welcome
    case createPassword
}

struct OnboardingView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var error: String?
    @State private var step: OnboardingStep = .welcome
    @FocusState private var focusedField: Field?

    private enum Field {
        case password, confirm
    }

    var body: some View {
        ZStack {
            ScreenBackground()

            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 0) {
                        HStack {
                            Wordmark()
                            Spacer()
                            StatusLabel("Local only", color: Theme.dim)
                        }

                        Spacer(minLength: 24)

                        switch step {
                        case .welcome:
                            welcomeStep
                        case .createPassword:
                            passwordStep
                        }

                        Spacer(minLength: 24)
                    }
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .frame(minHeight: geometry.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }

            Scanlines().ignoresSafeArea()
        }
    }

    private var welcomeStep: some View {
        VStack(spacing: 0) {
            Muninn(mood: .watching, size: 220)
                .padding(18)
                .overlay(CornerBrackets())

            PromptLine("New wallet")
                .padding(.top, 22)

            Text("Byoky Wallet")
                .uppercaseDisplay()
                .font(.display(32, relativeTo: .largeTitle))
                .tracking(1)
                .foregroundStyle(Theme.bone)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)

            Text("Your encrypted wallet for AI API keys. Keys stay on this device — apps use them without ever seeing them.")
                .font(.body)
                .foregroundStyle(Theme.fog)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                .padding(.horizontal, 8)

            Button("Get Started") {
                withAnimation { step = .createPassword }
            }
            .buttonStyle(.retroPrimary)
            .padding(.top, 28)
            .accessibilityIdentifier("onboarding.getStarted")
        }
    }

    private var passwordStep: some View {
        VStack(spacing: 0) {
            Muninn(mood: .watching, size: 120)

            PromptLine("Encrypt your keys")
                .padding(.top, 12)

            Text("Set Master Password")
                .uppercaseDisplay()
                .font(.display(28, relativeTo: .largeTitle))
                .tracking(0.8)
                .foregroundStyle(Theme.bone)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)

            Text("This password encrypts all your API keys. It's never stored — only a hash is kept to verify unlock.")
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                .padding(.horizontal, 8)

            VStack(alignment: .leading, spacing: 8) {
                SectionLabel("Master password", color: Theme.fog)
                SecureField("Master password", text: $password)
                    .font(.mono(16))
                    .foregroundStyle(Theme.bone)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .password)
                    .retroField(focused: focusedField == .password)
                    .accessibilityIdentifier("onboarding.password")

                SectionLabel("Confirm password", color: Theme.fog)
                    .padding(.top, 8)
                SecureField("Confirm password", text: $confirmPassword)
                    .font(.mono(16))
                    .foregroundStyle(Theme.bone)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirm)
                    .retroField(focused: focusedField == .confirm)
                    .accessibilityIdentifier("onboarding.confirmPassword")

                if !password.isEmpty {
                    let quality = PasswordQuality.evaluate(password)
                    HStack(spacing: 6) {
                        Image(systemName: quality.icon)
                        Text(quality.message)
                    }
                    .font(.mono(12, relativeTo: .caption))
                    .foregroundStyle(quality.color)
                    .padding(.top, 4)
                }

                if let error {
                    Text(error)
                        .font(.mono(12, relativeTo: .caption))
                        .foregroundStyle(Theme.alarm)
                }
            }
            .padding(.top, 24)

            Button("Create Wallet") {
                createWallet()
            }
            .buttonStyle(.retroPrimary)
            .disabled(!isValid)
            .padding(.top, 24)
            .accessibilityIdentifier("onboarding.createWallet")

            Button("Back") {
                withAnimation { step = .welcome }
            }
            .buttonStyle(.bracket(Theme.fog))
            .padding(.top, 8)
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
        case .tooShort: return Theme.dim
        case .weak: return Theme.amber
        case .fair: return Theme.phosphor
        case .strong: return Theme.signal
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
