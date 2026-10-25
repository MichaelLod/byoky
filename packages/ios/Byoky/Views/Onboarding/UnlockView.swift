import Combine
import SwiftUI

struct UnlockView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var error: String?
    @State private var isShaking = false
    @State private var lockoutRemaining: Int = 0
    @State private var showResetConfirmation = false
    @State private var showPassword = false
    /// Set once the password is accepted, for the moment before the
    /// wallet screen replaces this one.
    @State private var awake = false
    @FocusState private var isPasswordFocused: Bool

    private let lockoutTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var isLockedOut: Bool {
        lockoutRemaining > 0
    }

    var body: some View {
        ZStack {
            ScreenBackground()

            // Scrolls only when the keyboard leaves too little room.
            GeometryReader { geometry in
                ScrollView {
                    content
                        .frame(minHeight: geometry.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }

            Scanlines().ignoresSafeArea()
        }
        .alert("Reset Wallet?", isPresented: $showResetConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) {
                wallet.resetWallet()
            }
        } message: {
            Text("This will permanently delete all API keys, sessions, and settings. This cannot be undone.")
        }
        .onReceive(lockoutTimer) { _ in
            updateLockoutState()
        }
        .onAppear {
            updateLockoutState()
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            // Asleep while locked. It wakes as the wallet opens and
            // greets you with a nod from the wallet header.
            Muninn(mood: awake ? .watching : .asleep, size: isPasswordFocused ? 140 : 220, nod: awake ? 1 : 0)
                .animation(.easeInOut(duration: 0.25), value: isPasswordFocused)

            PromptLine("Wallet locked")
                .padding(.top, 8)

            Text("Muninn is asleep")
                .uppercaseDisplay()
                .font(.display(30, relativeTo: .largeTitle))
                .tracking(0.9)
                .foregroundStyle(Theme.bone)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)

            Text("Your keys are encrypted on this device. Enter your master password to wake Muninn.")
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 12) {
                SectionLabel("Master password", color: Theme.fog)

                HStack(spacing: 10) {
                    SwiftUI.Group {
                        if showPassword {
                            TextField("Master password", text: $password)
                        } else {
                            SecureField("Master password", text: $password)
                        }
                    }
                    .font(.mono(16))
                    .foregroundStyle(Theme.bone)
                    // Shown or hidden, the password stays out of QuickType
                    // and autocorrect.
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .focused($isPasswordFocused)
                    .submitLabel(.go)
                    .onSubmit { unlock() }
                    .accessibilityIdentifier("unlock.password")
                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.dim)
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                    .disabled(isLockedOut)
                }
                .retroField(focused: isPasswordFocused)
                .animation(.easeInOut(duration: 0.15), value: isPasswordFocused)
                .offset(x: isShaking ? -8 : 0)
                .disabled(isLockedOut)

                if isLockedOut {
                    HStack(spacing: 6) {
                        Image(systemName: "lock.fill")
                        Text("Too many attempts. Try again in \(lockoutRemaining)s")
                    }
                    .font(.mono(12, relativeTo: .caption))
                    .foregroundStyle(Theme.amber)
                } else if let error {
                    Text(error)
                        .font(.mono(12, relativeTo: .caption))
                        .foregroundStyle(Theme.alarm)
                }

                Button("Unlock") {
                    unlock()
                }
                .buttonStyle(.retroPrimary)
                .disabled(password.isEmpty || isLockedOut)
                .accessibilityIdentifier("unlock.submit")
            }
            .padding(.top, 24)

            Spacer(minLength: 16)

            Button("Forgot password?") {
                showResetConfirmation = true
            }
            .buttonStyle(.bracket(Theme.dim))

            HStack {
                Text("Keys stay on this device")
                Spacer()
                Text("AES-256-GCM")
            }
            .font(.mono(11, relativeTo: .caption2))
            .foregroundStyle(Theme.dim)
            .padding(.top, 4)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
    }

    private func updateLockoutState() {
        if let endTime = wallet.lockoutEndTime {
            let remaining = max(0, Int(endTime.timeIntervalSinceNow))
            lockoutRemaining = remaining
            if remaining == 0 {
                wallet.lockoutEndTime = nil
            }
        } else {
            lockoutRemaining = 0
        }
    }

    private func unlock() {
        guard !isLockedOut else { return }
        do {
            try wallet.unlock(password: password)
            awake = true
        } catch WalletError.lockedOut(let seconds) {
            lockoutRemaining = seconds
            error = nil
            password = ""
        } catch {
            self.error = "Wrong password"
            password = ""
            withAnimation(.default.repeatCount(3, autoreverses: true).speed(6)) {
                isShaking = true
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                isShaking = false
            }
        }
    }
}
