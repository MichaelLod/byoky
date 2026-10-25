import SwiftUI
import UniformTypeIdentifiers

/// The `.byoky` file as a document, for `.fileExporter`.
struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.byokyBackup] }

    let contents: String

    init(contents: String) {
        self.contents = contents
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents,
              let text = String(data: data, encoding: .utf8) else {
            throw BackupFile.BackupError.notABackupFile
        }
        contents = text
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(contents.utf8))
    }
}

// MARK: - Export

/// Settings → Export backup. Asks for the wallet password again, then for an
/// export password (same rule as the extension), encrypts every key off the
/// main thread, and offers the file via the share sheet (AirDrop, Mail, …)
/// or Save to Files.
struct ExportBackupView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable {
        case form
        case working
        case ready(contents: String, fileURL: URL)
    }

    @State private var masterPassword = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var phase: Phase = .form
    @State private var progress: Double = 0
    @State private var showSaveToFiles = false
    @State private var savedToFiles = false

    private var strength: BackupPasswordStrength { BackupPasswordStrength.check(password) }

    private var canSubmit: Bool {
        !masterPassword.isEmpty
            && password.utf16.count >= BackupPasswordStrength.minLength
            && strength.isAcceptable
            && !confirm.isEmpty
    }

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                switch phase {
                case .form: form
                case .working: working
                case .ready(let contents, let fileURL): ready(contents: contents, fileURL: fileURL)
                }
            }
            .retroNavigationTitle("Export Backup")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isReady ? "Done" : "Cancel") { dismiss() }
                        .disabled(phase == .working)
                        .accessibilityIdentifier("exportBackup.close")
                }
            }
        }
        .interactiveDismissDisabled(phase == .working)
        .onDisappear(perform: removeTemporaryFile)
    }

    private var isReady: Bool {
        if case .ready = phase { return true }
        return false
    }

    private var form: some View {
        List {
            Section {
                SecureField("Wallet password", text: $masterPassword)
                    .font(.mono(15))
                    .textContentType(.password)
                    .accessibilityIdentifier("exportBackup.masterPassword")
            } header: {
                ListHeader("Confirm it's you")
            } footer: {
                ListFooter("The password you use to unlock Byoky.")
            }
            .retroRow()

            Section {
                SecureField("Export password", text: $password)
                    .font(.mono(15))
                    .textContentType(.newPassword)
                    .accessibilityIdentifier("exportBackup.password")
                if !password.isEmpty {
                    Label(strength.label, systemImage: strength.isAcceptable ? "checkmark.shield" : "exclamationmark.triangle")
                        .font(.mono(12, relativeTo: .caption))
                        .foregroundStyle(strength.isAcceptable ? Theme.signal : Theme.amber)
                    if let hint = strength.feedback.first {
                        Text(hint)
                            .font(.caption)
                            .foregroundStyle(Theme.fog)
                    }
                }
                SecureField("Confirm password", text: $confirm)
                    .font(.mono(15))
                    .textContentType(.newPassword)
                    .accessibilityIdentifier("exportBackup.confirm")
            } header: {
                ListHeader("Backup password")
            } footer: {
                ListFooter("Choose a password to encrypt your backup. You'll need it to import the file later, on this device or another one — the Byoky browser extension and Android app can import it too.")
            }
            .retroRow()

            if let error {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(Theme.alarm)
                }
                .retroRow(border: Theme.alarm)
            }

            Section {
                Button("Create Backup", action: export)
                    .buttonStyle(.retroPrimary)
                    .disabled(!canSubmit)
                    .accessibilityIdentifier("exportBackup.submit")
            }
            .buttonRow()
        }
        .retroList()
    }

    private var working: some View {
        VStack(spacing: 16) {
            ProgressView(value: progress)
                .tint(Theme.violet)
                .padding(.horizontal, 40)
            Text("Encrypting \(wallet.credentials.count) key\(wallet.credentials.count == 1 ? "" : "s")…")
                .font(.mono(13, relativeTo: .callout))
                .foregroundStyle(Theme.fog)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScreenBackground())
    }

    private func ready(contents: String, fileURL: URL) -> some View {
        List {
            Section {
                Label(fileURL.lastPathComponent, systemImage: "doc.badge.lock")
                    .font(.mono(13, weight: .medium, relativeTo: .callout))
                    .foregroundStyle(Theme.bone)
                ShareLink(item: fileURL) {
                    Label("Share…", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("exportBackup.share")
                Button {
                    showSaveToFiles = true
                } label: {
                    Label(savedToFiles ? "Saved to Files" : "Save to Files", systemImage: "folder")
                }
                .accessibilityIdentifier("exportBackup.saveToFiles")
            } header: {
                ListHeader("Backup ready")
            } footer: {
                ListFooter("Anyone with this file and its password can use your keys. Keep both safe, and store them separately.")
            }
            .retroRow()
        }
        .retroList()
        .fileExporter(
            isPresented: $showSaveToFiles,
            document: BackupDocument(contents: contents),
            contentType: .byokyBackup,
            defaultFilename: fileURL.deletingPathExtension().lastPathComponent
        ) { result in
            if case .success = result { savedToFiles = true }
        }
    }

    private func export() {
        error = nil
        guard password.utf16.count >= BackupPasswordStrength.minLength else {
            error = "Password must be at least \(BackupPasswordStrength.minLength) characters"
            return
        }
        guard strength.isAcceptable else {
            error = "Password is too weak"
            return
        }
        guard password == confirm else {
            error = "Passwords do not match"
            return
        }

        phase = .working
        progress = 0
        let walletPassword = masterPassword
        let exportPassword = password
        Task {
            do {
                let contents = try await wallet.exportBackup(
                    masterPassword: walletPassword,
                    exportPassword: exportPassword
                ) { value in
                    Task { @MainActor in progress = value }
                }
                let fileURL = try writeTemporaryFile(contents)
                masterPassword = ""
                password = ""
                confirm = ""
                phase = .ready(contents: contents, fileURL: fileURL)
            } catch WalletError.wrongPassword {
                masterPassword = ""
                self.error = "Wrong wallet password"
                phase = .form
            } catch {
                self.error = error.localizedDescription
                phase = .form
            }
        }
    }

    /// The share sheet needs a real file with the right name.
    private func writeTemporaryFile(_ contents: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("byoky-export-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(BackupFile.suggestedFileName())
        try Data(contents.utf8).write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    private func removeTemporaryFile() {
        if case .ready(_, let fileURL) = phase {
            try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent())
        }
    }
}

// MARK: - Import

/// Import a `.byoky` file picked in Settings or opened from another app.
/// Decrypts and validates first (cancellable), shows exactly what would be
/// added — provider, label and server address — and stores nothing until the
/// user confirms. New keys are merged in; duplicates and keys this device
/// can't use are skipped and counted; nothing existing is touched.
struct ImportBackupView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) private var dismiss
    let file: PendingBackupFile

    private enum Phase: Equatable {
        case form
        case working
        case confirm(WalletStore.BackupImportPreview)
        case done(WalletStore.BackupImportSummary)
    }

    @State private var password = ""
    @State private var error: String?
    @State private var phase: Phase = .form
    @State private var progress: Double = 0
    @State private var work: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                switch phase {
                case .form: form
                case .working: working
                case .confirm(let preview): confirm(preview)
                case .done(let summary): done(summary)
                }
            }
            .retroNavigationTitle("Import Backup")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(isDone ? "Done" : "Cancel") {
                        work?.cancel()
                        dismiss()
                    }
                    .accessibilityIdentifier("importBackup.close")
                }
            }
        }
        .onDisappear { work?.cancel() }
    }

    private var isDone: Bool {
        if case .done = phase { return true }
        return false
    }

    private var form: some View {
        List {
            Section {
                Label(file.fileName, systemImage: "doc.badge.lock")
                    .font(.mono(13, weight: .medium, relativeTo: .callout))
                    .foregroundStyle(Theme.bone)
                if file.readError == nil {
                    SecureField("Backup password", text: $password)
                        .font(.mono(15))
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit(decrypt)
                        .accessibilityIdentifier("importBackup.password")
                }
            } footer: {
                ListFooter("You'll see which keys the backup contains before anything is added. Keys you already have stay as they are.")
            }
            .retroRow()

            if let message = file.readError ?? error {
                Section {
                    Label(message, systemImage: "exclamationmark.triangle")
                        .font(.callout)
                        .foregroundStyle(Theme.alarm)
                        .accessibilityIdentifier("importBackup.error")
                }
                .retroRow(border: Theme.alarm)
            }

            if file.readError == nil {
                Section {
                    Button("Decrypt", action: decrypt)
                        .buttonStyle(.retroPrimary)
                        .disabled(password.isEmpty)
                        .accessibilityIdentifier("importBackup.submit")
                }
                .buttonRow()
            }
        }
        .retroList()
    }

    private var working: some View {
        VStack(spacing: 16) {
            ProgressView(value: progress)
                .tint(Theme.violet)
                .padding(.horizontal, 40)
            Text("Decrypting backup…")
                .font(.mono(13, relativeTo: .callout))
                .foregroundStyle(Theme.fog)
            Button("Cancel", role: .cancel) {
                work?.cancel()
            }
            .buttonStyle(.bracket)
            .accessibilityIdentifier("importBackup.cancelDecrypt")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScreenBackground())
    }

    private func confirm(_ preview: WalletStore.BackupImportPreview) -> some View {
        List {
            if preview.toAdd.isEmpty {
                Section {
                    Label("No new keys found in the backup.", systemImage: "checkmark.circle")
                        .foregroundStyle(Theme.bone)
                }
                .retroRow()
            } else {
                Section {
                    ForEach(Array(preview.toAdd.enumerated()), id: \.offset) { _, entry in
                        HStack(spacing: 12) {
                            ProviderTile(providerId: entry.providerId, size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Provider.find(entry.providerId)?.name ?? entry.providerId)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(Theme.bone)
                                Text(entry.authMethod == .oauth ? "\(entry.label) · Setup token" : entry.label)
                                    .font(.caption)
                                    .foregroundStyle(Theme.fog)
                                if let baseUrl = entry.baseUrl {
                                    Text(baseUrl)
                                        .font(.mono(12, relativeTo: .caption))
                                        .foregroundStyle(Theme.amber)
                                        .accessibilityLabel("Server \(baseUrl)")
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    ListHeader("\(preview.toAdd.count) key\(preview.toAdd.count == 1 ? "" : "s") to add")
                } footer: {
                    if preview.toAdd.contains(where: { $0.baseUrl != nil }) {
                        ListFooter("Requests for keys with a server address are sent to that server. Only continue if you recognize it.")
                    }
                }
                .retroRow()
            }

            skippedSection(duplicates: preview.duplicates, unsupported: preview.unsupported)

            Section {
                if preview.toAdd.isEmpty {
                    Button("Done") { dismiss() }
                        .buttonStyle(.retroGhost)
                } else {
                    Button("Add \(preview.toAdd.count) Key\(preview.toAdd.count == 1 ? "" : "s")") {
                        commit(preview)
                    }
                    .buttonStyle(.retroPrimary)
                    .accessibilityIdentifier("importBackup.confirm")
                }
            }
            .buttonRow()
        }
        .retroList()
    }

    private func done(_ summary: WalletStore.BackupImportSummary) -> some View {
        List {
            Section {
                Label(
                    summary.added == 0
                        ? "No new keys were added."
                        : "Added \(summary.added) key\(summary.added == 1 ? "" : "s").",
                    systemImage: summary.added == 0 ? "checkmark.circle" : "key.fill"
                )
                .foregroundStyle(summary.added == 0 ? Theme.bone : Theme.signal)
                .accessibilityIdentifier("importBackup.summary")
            }
            .retroRow()
            skippedSection(duplicates: summary.duplicates, unsupported: summary.unsupported)
        }
        .retroList()
    }

    @ViewBuilder
    private func skippedSection(duplicates: Int, unsupported: Int) -> some View {
        if duplicates > 0 || unsupported > 0 {
            Section {
                if duplicates > 0 {
                    Text("\(duplicates) already in your wallet \(duplicates == 1 ? "is" : "are") skipped.")
                        .foregroundStyle(Theme.fog)
                }
                if unsupported > 0 {
                    Text("\(unsupported) \(unsupported == 1 ? "key isn't" : "keys aren't") usable on iPhone (unknown provider, missing or unsafe server address, or unsupported sign-in) and \(unsupported == 1 ? "is" : "are") skipped.")
                        .foregroundStyle(Theme.fog)
                }
            }
            .retroRow()
        }
    }

    private func decrypt() {
        guard !password.isEmpty, phase == .form else { return }
        error = nil
        phase = .working
        progress = 0
        let importPassword = password
        work = Task {
            do {
                let preview = try await wallet.prepareBackupImport(contents: file.contents, password: importPassword) { value in
                    Task { @MainActor in progress = value }
                }
                password = ""
                phase = .confirm(preview)
            } catch is CancellationError {
                phase = .form
            } catch {
                self.error = error.localizedDescription
                phase = .form
            }
        }
    }

    private func commit(_ preview: WalletStore.BackupImportPreview) {
        do {
            phase = .done(try wallet.commitBackupImport(preview))
        } catch {
            self.error = error.localizedDescription
            phase = .form
        }
    }
}
