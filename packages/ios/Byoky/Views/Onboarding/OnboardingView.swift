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
                        // The status goes under the wordmark when both
                        // don't fit on one line.
                        ViewThatFits(in: .horizontal) {
                            HStack {
                                Wordmark()
                                Spacer()
                                StatusLabel("Local only", color: Theme.dim)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Wordmark()
                                StatusLabel("Local only", color: Theme.dim)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
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
                    // Return moves on to Confirm, which the keyboard covers
                    // on smaller phones.
                    .submitLabel(.next)
                    .onSubmit { focusedField = .confirm }
                    .accessibilityIdentifier("onboarding.password")

                // The strength line rates the password above it; the confirm
                // field says when the two differ, so a disabled Create Wallet
                // always has a reason.
                if !password.isEmpty {
                    PasswordStrengthLine(strength: BackupPasswordStrength.check(password))
                }

                SectionLabel("Confirm password", color: Theme.fog)
                    .padding(.top, 8)
                SecureField("Confirm password", text: $confirmPassword)
                    .font(.mono(16))
                    .foregroundStyle(Theme.bone)
                    .textContentType(.newPassword)
                    .focused($focusedField, equals: .confirm)
                    .retroField(focused: focusedField == .confirm)
                    // Return creates the wallet, as Go does on Android.
                    .submitLabel(.go)
                    .onSubmit { if isValid { createWallet() } }
                    .accessibilityIdentifier("onboarding.confirmPassword")

                if passwordsDiffer {
                    Label("Passwords do not match", systemImage: "xmark.circle")
                        .font(.mono(12, relativeTo: .caption))
                        .foregroundStyle(Theme.alarm)
                        .accessibilityIdentifier("onboarding.passwordMismatch")
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

    private var passwordsDiffer: Bool {
        !confirmPassword.isEmpty && confirmPassword != password
    }

    /// The extension's master-password rule (core checkPasswordStrength: 12+
    /// characters, score 2 or more), the same one the export screen applies.
    private var isValid: Bool {
        password == confirmPassword
            && password.utf16.count >= BackupPasswordStrength.minLength
            && BackupPasswordStrength.check(password).isAcceptable
    }

    private func createWallet() {
        do {
            try wallet.createPassword(password)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Strength label and first hint for a password being chosen, scored like
/// the extension and the export screen score it.
private struct PasswordStrengthLine: View {
    let strength: BackupPasswordStrength

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(strength.label, systemImage: strength.isAcceptable ? "checkmark.shield" : "exclamationmark.triangle")
                .font(.mono(12, relativeTo: .caption))
                .foregroundStyle(strength.isAcceptable ? Theme.signal : Theme.amber)
            if let hint = strength.feedback.first {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(Theme.fog)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("onboarding.passwordStrength")
    }
}
