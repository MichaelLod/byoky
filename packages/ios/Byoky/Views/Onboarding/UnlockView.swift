import SwiftUI

struct UnlockView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var error: String?
    @State private var isShaking = false
    @State private var lockoutRemaining: Int = 0
    @State private var showResetConfirmation = false
    @State private var showPassword = false
    @FocusState private var isPasswordFocused: Bool

    private let lockoutTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var isLockedOut: Bool {
        lockoutRemaining > 0
    }

    var body: some View {
        ZStack {
            Theme.bgMain.ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                BrandMark(size: 120)

                Text("Byoky Wallet")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)

                if let username = wallet.cloudVaultUsername ?? wallet.cloudVaultLastUsername {
                    VStack(spacing: 4) {
                        Text(username)
                            .font(.callout)
                            .fontWeight(.semibold)
                            .foregroundStyle(Theme.textPrimary)
                        Text("Enter your master password to unlock")
                            .font(.callout)
                            .foregroundStyle(Theme.textSecondary)
                    }
                } else {
                    Text("Enter your master password to unlock")
                        .font(.callout)
                        .foregroundStyle(Theme.textSecondary)
                }

                VStack(spacing: 16) {
                    HStack(spacing: 10) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textMuted)
                            .frame(width: 18)
                        SwiftUI.Group {
                            if showPassword {
                                TextField("Master password", text: $password)
                            } else {
                                SecureField("Master password", text: $password)
                            }
                        }
                        .textContentType(.password)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .focused($isPasswordFocused)
                        .submitLabel(.go)
                        .onSubmit { unlock() }
                        .accessibilityIdentifier("unlock.password")
                        Button {
                            showPassword.toggle()
                        } label: {
                            Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                                .font(.system(size: 15))
                                .foregroundStyle(Theme.textMuted)
                                .frame(width: 18)
                        }
                        .buttonStyle(.plain)
                        .disabled(isLockedOut)
                    }
                    .padding(14)
                    .background(Theme.bgRaised)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isPasswordFocused ? Theme.accent : Theme.border,
                                    lineWidth: isPasswordFocused ? 1.5 : 1)
                    )
                    .animation(.easeInOut(duration: 0.15), value: isPasswordFocused)
                    .offset(x: isShaking ? -8 : 0)
                    .disabled(isLockedOut)

                    if isLockedOut {
                        HStack(spacing: 6) {
                            Image(systemName: "lock.fill")
                            Text("Too many attempts. Try again in \(lockoutRemaining)s")
                        }
                        .font(.caption)
                        .foregroundStyle(.orange)
                    } else if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }

                    Button {
                        unlock()
                    } label: {
                        Text("Unlock")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(password.isEmpty || isLockedOut ? Theme.accent.opacity(0.3) : Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(password.isEmpty || isLockedOut)
                    .accessibilityIdentifier("unlock.submit")
                }
                .padding(.horizontal, 24)

                Spacer()

                Button {
                    showResetConfirmation = true
                } label: {
                    Text("Forgot password?")
                        .font(.callout)
                        .foregroundStyle(Theme.textMuted)
                }

                Spacer()
            }
            .padding(24)
        }
        .preferredColorScheme(.light)
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
