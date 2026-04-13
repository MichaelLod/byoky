import SwiftUI

struct UnlockView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var error: String?
    @State private var isShaking = false
    @State private var lockoutRemaining: Int = 0
    @State private var showResetConfirmation = false

    private let lockoutTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var isLockedOut: Bool {
        lockoutRemaining > 0
    }

    var body: some View {
        ZStack {
            Theme.bgMain.ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                MascotView(size: 120)

                Text("Byoky Wallet")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)

                Text("Enter your master password to unlock")
                    .font(.callout)
                    .foregroundStyle(Theme.textSecondary)

                VStack(spacing: 16) {
                    SecureField("Master password", text: $password)
                        .textContentType(.password)
                        .padding(14)
                        .background(Theme.bgRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.white.opacity(0.06), lineWidth: 1)
                        )
                        .offset(x: isShaking ? -8 : 0)
                        .onSubmit { unlock() }
                        .disabled(isLockedOut)
                        .accessibilityIdentifier("unlock.password")

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
        .preferredColorScheme(.dark)
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
