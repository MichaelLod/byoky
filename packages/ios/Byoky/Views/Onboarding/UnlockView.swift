import SwiftUI

struct UnlockView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var password = ""
    @State private var error: String?
    @State private var isShaking = false

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

                    if let error {
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
                            .background(password.isEmpty ? Theme.accent.opacity(0.3) : Theme.accent)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(password.isEmpty)
                }
                .padding(.horizontal, 24)

                Spacer()
                Spacer()
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private func unlock() {
        do {
            try wallet.unlock(password: password)
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
