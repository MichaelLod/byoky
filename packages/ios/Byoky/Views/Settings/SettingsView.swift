import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var wallet: WalletStore
    @State private var showSafariGuide = false
    @State private var showCloudVault = false
    @State private var showCloudVaultRelogin = false

    @State private var debugSelfTestReport: String?
    @State private var showRoutingEditor = false

    var body: some View {
        NavigationStack {
            List {
                safariExtensionSection
                routingSection
                cloudVaultSection
                securitySection
                #if DEBUG
                translationDebugSection
                #endif
                aboutSection
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showRoutingEditor) {
                GroupEditorSheet()
                    .environmentObject(wallet)
            }
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

    private var routingSection: some View {
        Section {
            Button {
                showRoutingEditor = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 20))
                        .foregroundStyle(Theme.accent)
                        .frame(width: 32)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Cross-family routing")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.primary)
                        if let group = wallet.groups.first(where: { $0.id == defaultGroupId }) {
                            let provider = Provider.find(group.providerId)?.name ?? group.providerId
                            if let model = group.model, !model.isEmpty {
                                Text("Routing to: \(provider) · \(model)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("Pass-through (no model configured)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Text("Tap to configure")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        } header: {
            Text("Routing")
        } footer: {
            Text("When an app requests a different provider family, route the call through this destination instead. Same-family requests always pass through unchanged.")
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

/// Edit the default group's destination provider + model. Mobile uses the
/// default group as a global routing rule (no per-app origin yet), so this
/// sheet is the single point of control for cross-family translation. The
/// data model supports multi-group editing for forward compat, but only
/// the default is exposed in the UI today.
struct GroupEditorSheet: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    @State private var providerId: String = "anthropic"
    @State private var model: String = ""
    @State private var error: String?
    @State private var suggestedModels: [(id: String, displayName: String)] = []
    @State private var selectedModelInfo: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Destination provider", selection: $providerId) {
                        ForEach(Provider.all, id: \.id) { provider in
                            Text(provider.name).tag(provider.id)
                        }
                    }
                    .onChange(of: providerId) { _, newValue in
                        loadSuggestedModels(for: newValue)
                    }

                    TextField("Destination model (e.g. gpt-4o)", text: $model)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .onChange(of: model) { _, newValue in
                            updateModelInfo(for: newValue)
                        }

                    if !suggestedModels.isEmpty {
                        ForEach(suggestedModels, id: \.id) { entry in
                            Button {
                                model = entry.id
                                updateModelInfo(for: entry.id)
                            } label: {
                                HStack {
                                    Text(entry.displayName)
                                        .font(.callout)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(entry.id)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Default group")
                } footer: {
                    if let info = selectedModelInfo {
                        Text(info).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("All requests from apps in a different provider family will be routed here. Same-family requests pass through unchanged. Leave model empty to disable routing.")
                    }
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button("Save") {
                        save()
                    }
                    .disabled(providerId.isEmpty)

                    if !model.isEmpty {
                        Button("Disable routing", role: .destructive) {
                            model = ""
                            save()
                        }
                    }
                }
            }
            .navigationTitle("Routing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear {
                if let group = wallet.groups.first(where: { $0.id == defaultGroupId }) {
                    providerId = group.providerId
                    model = group.model ?? ""
                }
                loadSuggestedModels(for: providerId)
                if !model.isEmpty { updateModelInfo(for: model) }
            }
        }
    }

    /// Pull the @byoky/core registry's known models for this provider, via
    /// the JS bridge. Empty list means the registry has no entries — the
    /// user can still type a custom model name.
    private func loadSuggestedModels(for provider: String) {
        let json = TranslationEngine.shared.getModelsForProvider(provider)
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            suggestedModels = []
            return
        }
        suggestedModels = arr.compactMap { entry in
            guard let id = entry["id"] as? String,
                  let displayName = entry["displayName"] as? String else { return nil }
            return (id: id, displayName: displayName)
        }
    }

    /// Look up the chosen model in the registry and produce a one-line
    /// capability summary for the footer. Empty when the model isn't in
    /// the registry — that's fine, the user can still type custom names.
    private func updateModelInfo(for modelId: String) {
        guard let json = TranslationEngine.shared.describeModel(modelId),
              let data = json.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let caps = parsed["capabilities"] as? [String: Any] else {
            selectedModelInfo = nil
            return
        }
        var bits: [String] = []
        if caps["tools"] as? Bool == true { bits.append("tools") }
        if caps["vision"] as? Bool == true { bits.append("vision") }
        if caps["structuredOutput"] as? Bool == true { bits.append("JSON schema") }
        if caps["reasoning"] as? Bool == true { bits.append("reasoning") }
        let context = parsed["contextWindow"] as? Int ?? 0
        let display = parsed["displayName"] as? String ?? modelId
        let contextK = context >= 1000 ? "\(context / 1000)K" : "\(context)"
        selectedModelInfo = "\(display): \(contextK) ctx · " + bits.joined(separator: " · ")
    }

    private func save() {
        do {
            try wallet.updateGroup(
                id: defaultGroupId,
                providerId: providerId,
                model: .some(model.isEmpty ? nil : model)
            )
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
