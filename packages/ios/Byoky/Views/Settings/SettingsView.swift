import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showCloudVault = false
    @State private var showCloudVaultRelogin = false
    @State private var showDeleteAccountConfirm = false
    @State private var showResetWalletConfirm = false
    @State private var dangerError: String?

    @State private var debugSelfTestReport: String?

    var body: some View {
        NavigationStack {
            List {
                cloudVaultSection
                securitySection
                #if DEBUG
                translationDebugSection
                #endif
                aboutSection
                dangerZoneSection
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showCloudVault) {
                CloudVaultSetupView(lastUsername: wallet.cloudVaultLastUsername)
                    .environmentObject(wallet)
            }
            .sheet(isPresented: $showCloudVaultRelogin) {
                CloudVaultReloginView()
                    .environmentObject(wallet)
            }
            #if DEBUG
            .sheet(isPresented: Binding(
                get: { debugSelfTestReport != nil },
                set: { if !$0 { debugSelfTestReport = nil } }
            )) {
                NavigationStack {
                    ScrollView {
                        Text(debugSelfTestReport ?? "")
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                    }
                    .navigationTitle("Self-test")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { debugSelfTestReport = nil }
                        }
                    }
                }
            }
            #endif
            .alert("Delete Cloud Sync Account?", isPresented: $showDeleteAccountConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) {
                    Task {
                        do {
                            try await wallet.deleteVaultAccount()
                        } catch {
                            dangerError = error.localizedDescription
                        }
                    }
                }
            } message: {
                Text("Your vault account and all synced keys will be permanently deleted from vault.byoky.com. This device will also be reset. This cannot be undone.")
            }
            .alert("Reset Wallet?", isPresented: $showResetWalletConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Reset", role: .destructive) {
                    wallet.resetWallet()
                }
            } message: {
                Text(wallet.cloudVaultEnabled
                    ? "All keys on this device will be cleared. Your Cloud Sync account will NOT be deleted — use Delete Cloud Sync Account for that."
                    : "All keys on this device will be permanently deleted. This cannot be undone.")
            }
            .alert("Error", isPresented: Binding(
                get: { dangerError != nil },
                set: { if !$0 { dangerError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(dangerError ?? "")
            }
        }
    }

    private var dangerZoneSection: some View {
        Section {
            if wallet.cloudVaultEnabled {
                Button(role: .destructive) {
                    showDeleteAccountConfirm = true
                } label: {
                    HStack {
                        Label("Delete Cloud Sync Account", systemImage: "trash")
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
            }
            Button(role: .destructive) {
                showResetWalletConfirm = true
            } label: {
                HStack {
                    Label("Reset Wallet", systemImage: "arrow.counterclockwise")
                    Spacer()
                }
                .contentShape(Rectangle())
            }
        } header: {
            Text("Danger Zone")
        } footer: {
            Text(wallet.cloudVaultEnabled
                ? "Delete account removes your vault account and all synced keys. Reset wallet clears only this device."
                : "Reset wallet clears all keys on this device.")
        }
    }

    #if DEBUG
    private var translationDebugSection: some View {
        Section {
            Button {
                Task {
                    // Run on a background queue so the UI stays responsive on
                    // first call (cold-start bundle eval is fast but nonzero).
                    let report = await Task.detached(priority: .userInitiated) {
                        TranslationEngine.shared.runSelfTest()
                    }.value
                    debugSelfTestReport = report
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "ant.circle")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Run TranslationEngine self-test")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Verify the @byoky/core JS bundle round-trips a translation")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }
            }
        } header: {
            Text("Translation Engine (debug)")
        }
    }
    #endif

    private var cloudVaultSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { wallet.cloudVaultEnabled },
                set: { newValue in
                    if newValue {
                        showCloudVault = true
                    } else {
                        Task { await wallet.disableCloudVault() }
                    }
                }
            )) {
                HStack(spacing: 12) {
                    Image(systemName: "cloud")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Cloud Sync")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Sync credentials across your devices")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .tint(Theme.accent)
            .accessibilityIdentifier("settings.vaultToggle")

            if wallet.cloudVaultEnabled {
                if let username = wallet.cloudVaultUsername {
                    LabeledContent("Account", value: username)
                        .font(.caption)
                }

                if wallet.cloudVaultTokenExpired {
                    Button {
                        showCloudVaultRelogin = true
                    } label: {
                        HStack {
                            Image(systemName: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                            Text("Session expired — tap to re-login")
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
        } header: {
            Text("Cloud Sync")
        } footer: {
            if !wallet.cloudVaultEnabled {
                Text("Websites can use your keys even when this device is offline. Keys are encrypted server-side with AES-256-GCM.")
            }
        }
    }

    private var securitySection: some View {
        Section("Security") {
            Button {
                wallet.lock()
            } label: {
                HStack {
                    Label("Lock Wallet", systemImage: "lock")
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .foregroundStyle(.primary)
            .accessibilityIdentifier("settings.lock")

            LabeledContent("Encryption", value: "AES-256-GCM")
            LabeledContent("Key Derivation", value: "PBKDF2 (600K)")
            LabeledContent("Storage", value: "iOS Keychain")
        }
    }

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version", value: "1.0.0")

            Link(destination: URL(string: "https://github.com/MichaelLod/byoky")!) {
                Label("GitHub", systemImage: "link")
            }

            Link(destination: URL(string: "https://byoky.com")!) {
                Label("Website", systemImage: "globe")
            }
        }
    }
}

struct CloudVaultSetupView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var isSignup: Bool
    @State private var username: String
    @State private var password = ""
    @State private var loading = false
    @State private var error: String?
    @State private var usernameStatus: UsernameStatus = .idle
    @State private var checkTask: Task<Void, Never>?

    enum UsernameStatus: Equatable { case idle, checking, available, taken, invalid }

    init(lastUsername: String? = nil) {
        _isSignup = State(initialValue: lastUsername == nil)
        _username = State(initialValue: lastUsername ?? "")
    }

    private static let usernamePattern = "^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$"

    private var isUsernameValid: Bool {
        let trimmed = username.lowercased().trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3, trimmed.count <= 30 else { return false }
        return trimmed.range(of: Self.usernamePattern, options: .regularExpression) != nil
    }

    private func onUsernameChanged(_ value: String) {
        checkTask?.cancel()
        let trimmed = value.lowercased().trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count >= 3 else {
            usernameStatus = .idle
            return
        }
        guard trimmed.range(of: Self.usernamePattern, options: .regularExpression) != nil else {
            usernameStatus = .invalid
            return
        }
        usernameStatus = .checking
        checkTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            let result = await wallet.checkUsernameAvailability(trimmed)
            guard !Task.isCancelled else { return }
            if result.available {
                usernameStatus = .available
            } else {
                usernameStatus = result.reason == "invalid" ? .invalid : .taken
            }
        }
    }

    var body: some View {
        NavigationStack {
            authView
                .navigationTitle("Cloud Sync")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
        }
    }

    private var authView: some View {
        ScrollView {
            VStack(spacing: 20) {
                Picker("", selection: $isSignup) {
                    Text("Sign Up").tag(true)
                    Text("Login").tag(false)
                }
                .pickerStyle(.segmented)

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Username").font(.caption.weight(.medium))
                        TextField("Choose a username", text: $username)
                            .textContentType(.username)
                            .autocapitalization(.none)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("vaultAuth.username")
                            .onChange(of: username) { _, value in
                                if isSignup { onUsernameChanged(value) }
                            }
                        if isSignup && username.count >= 3 {
                            SwiftUI.Group {
                                switch usernameStatus {
                                case .checking:
                                    Text("Checking availability...")
                                        .foregroundStyle(.secondary)
                                case .available:
                                    Text("Username is available")
                                        .foregroundStyle(.green)
                                case .taken:
                                    Text("Username is already taken")
                                        .foregroundStyle(.red)
                                case .invalid:
                                    Text("Letters, numbers, hyphens, underscores only (3\u{2013}30 chars)")
                                        .foregroundStyle(.red)
                                case .idle:
                                    EmptyView()
                                }
                            }
                            .font(.caption2)
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Password").font(.caption.weight(.medium))
                        SecureField(isSignup ? "At least 12 characters" : "Your vault password", text: $password)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("vaultAuth.password")
                    }
                }

                Button {
                    submit()
                } label: {
                    if loading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text(isSignup ? "Sign Up" : "Login")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(loading || username.isEmpty || password.isEmpty || (isSignup && password.count < 12) || (isSignup && (usernameStatus == .taken || usernameStatus == .invalid || usernameStatus == .checking || !isUsernameValid)))
                .accessibilityIdentifier("vaultAuth.submit")
            }
            .padding(24)
        }
    }

    private func submit() {
        loading = true
        error = nil
        Task {
            do {
                try await wallet.enableCloudVault(username: username, password: password, isSignup: isSignup)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            loading = false
        }
    }
}

struct CloudVaultReloginView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var password = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    Text("Your session has expired. Enter your vault password to reconnect.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Username").font(.caption.weight(.medium))
                        TextField("", text: .constant(wallet.cloudVaultUsername ?? ""))
                            .disabled(true)
                            .textFieldStyle(.roundedBorder)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Password").font(.caption.weight(.medium))
                        SecureField("Your vault password", text: $password)
                            .textFieldStyle(.roundedBorder)
                    }

                    Button {
                        loading = true
                        error = nil
                        Task {
                            do {
                                try await wallet.reloginCloudVault(password: password)
                                dismiss()
                            } catch {
                                self.error = error.localizedDescription
                            }
                            loading = false
                        }
                    } label: {
                        if loading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Login")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(loading || password.isEmpty)
                }
                .padding(24)
            }
            .navigationTitle("Re-login to Cloud Sync")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

