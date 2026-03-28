import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showSafariGuide = false
    @State private var showCloudVault = false
    @State private var showCloudVaultRelogin = false

    var body: some View {
        NavigationStack {
            List {
                safariExtensionSection
                cloudVaultSection
                securitySection
                aboutSection
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showSafariGuide) {
                SafariExtensionGuide()
            }
            .sheet(isPresented: $showCloudVault) {
                CloudVaultSetupView()
                    .environmentObject(wallet)
            }
            .sheet(isPresented: $showCloudVaultRelogin) {
                CloudVaultReloginView()
                    .environmentObject(wallet)
            }
        }
    }

    private var safariExtensionSection: some View {
        Section {
            Button {
                showSafariGuide = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "safari")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Safari Extension Setup")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Enable Byoky in Safari to proxy requests")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Text("Safari Extension")
        } footer: {
            Text("The Safari extension lets websites connect to your wallet. You need to enable it once in Safari settings.")
        }
    }

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
                        Text("Cloud Vault")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        Text("Sync credentials to vault.byoky.com")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .tint(Theme.accent)

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
            Text("Cloud Vault")
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

struct SafariExtensionGuide: View {
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Enable the Byoky Safari extension to let websites connect to your wallet.")
                        .font(.body)
                        .foregroundStyle(.secondary)

                    guideStep(
                        number: 1,
                        title: "Open Settings",
                        description: "Go to Settings → Safari → Extensions"
                    )

                    guideStep(
                        number: 2,
                        title: "Enable Byoky",
                        description: "Find \"Byoky\" in the list and toggle it on"
                    )

                    guideStep(
                        number: 3,
                        title: "Allow Permissions",
                        description: "Grant permission for \"All Websites\" or specific sites you use"
                    )

                    guideStep(
                        number: 4,
                        title: "Keep the App Open",
                        description: "For OAuth tokens and remote tools, keep the Byoky app in the foreground. The bridge proxy runs as long as the app is active — if you switch away, it pauses and resumes when you return."
                    )

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Important", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                            .foregroundStyle(.orange)

                        Text("API key-based requests work even when the app is in the background. Only OAuth token requests and remote relay connections require the app to stay active.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .padding(16)
                    .background(Color.orange.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(24)
            }
            .navigationTitle("Safari Extension")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func guideStep(number: Int, title: String, description: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.callout.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 28, height: 28)
                .background(Theme.accent)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.semibold))
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct CloudVaultSetupView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var step: SetupStep = .warning
    @State private var understood = false
    @State private var isSignup = true
    @State private var username = ""
    @State private var password = ""
    @State private var loading = false
    @State private var error: String?
    @State private var usernameStatus: UsernameStatus = .idle
    @State private var checkTask: Task<Void, Never>?

    enum SetupStep { case warning, auth }
    enum UsernameStatus: Equatable { case idle, checking, available, taken, invalid }

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
            Group {
                if step == .warning {
                    warningView
                } else {
                    authView
                }
            }
            .navigationTitle("Cloud Vault")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var warningView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Cloud Vault", systemImage: "cloud")
                        .font(.headline)

                    Text("Cloud Vault lets websites use your credentials even when this device is offline. Your keys are sent to vault.byoky.com over an encrypted connection and stored with AES-256-GCM encryption using a key derived from your vault password.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Text("Note: your keys will be stored on a remote server.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding(16)
                .background(Color(.secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))

                Toggle("I understand my keys will be stored remotely", isOn: $understood)
                    .font(.callout)

                Button {
                    step = .auth
                } label: {
                    Text("Continue")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(!understood)
            }
            .padding(24)
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
                            .onChange(of: username) { _, value in
                                if isSignup { onUsernameChanged(value) }
                            }
                        if isSignup && username.count >= 3 {
                            Group {
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
            .navigationTitle("Re-login to Cloud Vault")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
