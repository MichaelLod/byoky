import Combine
import CryptoKit
import Foundation

@MainActor
final class WalletStore: ObservableObject {
    static let shared = WalletStore()

    @Published var status: WalletStatus = .uninitialized {
        // The idle timer runs exactly while the wallet is unlocked, whatever
        // path unlocked it (and even if a later step of unlocking threw).
        didSet {
            guard status != oldValue else { return }
            if status == .unlocked { startIdleTimer() } else { stopIdleTimer() }
        }
    }
    @Published var credentials: [Credential] = []
    @Published var sessions: [Session] = []
    @Published var requestLogs: [RequestLog] = []
    @Published var tokenAllowances: [TokenAllowance] = []
    /// Tokens each app has used, for allowances (see `TokenUsageLedger`).
    @Published private(set) var tokenLedger = TokenUsageLedger()
    @Published var groups: [Group] = []
    @Published var appGroups: AppGroups = [:]
    @Published var lockoutEndTime: Date?
    @Published var installedApps: [InstalledApp] = []
    /// One-time Wallet banner for users who relied on cloud sync, gifts or
    /// pairing before those features were retired.
    @Published var showRetiredFeaturesNotice = false
    /// A `.byoky` file opened from Files, AirDrop or Mail, waiting for the
    /// user to enter its password (MainTabView shows the import sheet).
    @Published var pendingBackupFile: PendingBackupFile?

    private let keychain = KeychainService.shared
    private let crypto = CryptoService.shared
    private var masterKey: SymmetricKey?

    private let passwordHashKey = "password_hash"
    private let masterSaltKey = "master_salt"
    private let credentialsKey = "credentials"
    private let sessionsKey = "sessions"
    private let requestLogKey = "requestLog"
    private let tokenAllowancesKey = "tokenAllowances"
    private let groupsKey = "groups"
    private let appGroupsKey = "appGroups"
    private let installedAppsKey = "installedApps"
    private let tokenLedgerKey = "tokenUsage"
    private let unlockLockoutKey = "unlockLockout"

    private let appConsent = AppConsentStore()

    /// Idle time after which the wallet locks, in the foreground or not.
    private let autoLockTimeout: TimeInterval = 900
    private var backgroundTime: Date?
    private var lastActivity = Date()
    private var idleLockTask: Task<Void, Never>?

    /// Requests in flight and the tokens each one holds.
    private var reservations: [UUID: TokenReservation] = [:]

    /// Failed unlock attempts and the lockout they caused. Kept in the
    /// keychain (this device only, never synced) next to the password hash:
    /// UserDefaults would be wiped by a reinstall while the hash survives,
    /// handing an attacker a fresh set of attempts.
    private struct UnlockLockout: Codable {
        var failedAttempts = 0
        var lockedUntil: Date?

        func merged(with other: UnlockLockout) -> UnlockLockout {
            UnlockLockout(
                failedAttempts: max(failedAttempts, other.failedAttempts),
                lockedUntil: [lockedUntil, other.lockedUntil].compactMap { $0 }.max()
            )
        }
    }
    /// In-memory copy, so attempts still count if a keychain read fails.
    private var unlockLockout = UnlockLockout()
    private static let legacyFailedAttemptsKey = "byoky_failedUnlockAttempts"
    private static let legacyLockoutEndKey = "byoky_lockoutEndTime"

    private init() {
        // Drop data left behind by the retired cloud vault, gift and relay
        // pairing features before anything else reads the keychain.
        LegacyDataCleanup.runIfNeeded()
        AppGroupSync.shared.removeRetiredProxyQueue()
        showRetiredFeaturesNotice = LegacyDataCleanup.shouldShowRetiredNotice()
        checkInitialized()
        restoreLockoutState()
        loadInstalledApps()
    }

    // MARK: - Initialization

    private func checkInitialized() {
        do {
            _ = try keychain.loadString(key: passwordHashKey)
            status = .locked
        } catch {
            status = .uninitialized
        }
    }

    private func restoreLockoutState() {
        migrateLegacyLockout()
        if let until = currentLockout().lockedUntil, Date() < until {
            lockoutEndTime = until
        }
    }

    var isUnlocked: Bool {
        status == .unlocked
    }

    // MARK: - Password

    func createPassword(_ password: String) throws {
        guard let hash = crypto.hashPassword(password) else {
            throw WalletError.passwordHashFailed
        }

        try keychain.saveString(key: passwordHashKey, value: hash)

        let salt = crypto.generateSalt()
        try keychain.save(key: masterSaltKey, data: salt)

        guard let key = crypto.deriveKey(password: password, salt: salt) else {
            throw WalletError.passwordHashFailed
        }
        masterKey = key
        resetFailedAttempts()

        // A new wallet starts empty, with the default group an unlock would
        // ensure. Without it, apps that connect right after setup don't show
        // in Connected Apps.
        credentials = []
        sessions = []
        requestLogs = []
        tokenAllowances = []
        tokenLedger = TokenUsageLedger()
        saveTokenLedger()
        groups = []
        appGroups = [:]
        status = .unlocked
        try? ensureDefaultGroup()

        AppGroupSync.shared.syncWalletState(isUnlocked: true, providers: [])
    }

    func unlock(password: String) throws {
        if let endTime = currentLockout().lockedUntil, Date() < endTime {
            lockoutEndTime = endTime
            throw WalletError.lockedOut(max(1, Int(endTime.timeIntervalSinceNow)))
        }

        let hash = try keychain.loadString(key: passwordHashKey)

        guard crypto.verifyPassword(password, hash: hash) else {
            handleFailedAttempt()
            throw WalletError.wrongPassword
        }

        resetFailedAttempts()

        let salt: Data
        do {
            salt = try keychain.load(key: masterSaltKey)
        } catch KeychainError.loadFailed {
            let newSalt = crypto.generateSalt()
            try keychain.save(key: masterSaltKey, data: newSalt)
            salt = newSalt
        }

        guard let key = crypto.deriveKey(password: password, salt: salt) else {
            throw WalletError.passwordHashFailed
        }
        masterKey = key

        status = .unlocked
        try loadCredentials()
        try pruneRemovedProviders()
        try loadSessions()
        loadRequestLogs()
        loadTokenAllowances()
        loadTokenLedger()
        loadGroups()
        loadAppGroups()
        // lock() clears the in-memory list, so reload it on every unlock —
        // otherwise the Apps tab stays empty until the next cold start.
        loadInstalledApps()
        try ensureDefaultGroup()
        try? clearStaleCredentialPins()
        try migrateCredentials(password: password)

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )
    }

    func lock() {
        masterKey = nil
        credentials = []
        sessions = []
        requestLogs = []
        tokenAllowances = []
        tokenLedger = TokenUsageLedger()
        reservations = [:]
        groups = []
        appGroups = [:]
        installedApps = []
        // Observers (the in-wallet browser) cancel their requests here.
        status = .locked
        backgroundTime = nil
        AppGroupSync.shared.syncWalletState(isUnlocked: false, providers: [])
    }

    func resetWallet() {
        masterKey = nil
        backgroundTime = nil

        // Load credential IDs from keychain even when locked,
        // so we can delete individual encrypted key entries
        var credentialIds: [String] = credentials.map(\.id)
        if credentialIds.isEmpty {
            if let stored = try? keychain.loadCodable(key: credentialsKey, as: [Credential].self) {
                credentialIds = stored.map(\.id)
            }
        }

        // Delete all keychain items
        for id in credentialIds {
            try? keychain.delete(key: "key_\(id)")
        }
        try? keychain.delete(key: passwordHashKey)
        try? keychain.delete(key: masterSaltKey)
        try? keychain.delete(key: credentialsKey)
        try? keychain.delete(key: sessionsKey)
        try? keychain.delete(key: requestLogKey)
        try? keychain.delete(key: tokenAllowancesKey)
        try? keychain.delete(key: tokenLedgerKey)
        try? keychain.delete(key: groupsKey)
        try? keychain.delete(key: appGroupsKey)
        // A full reset also removes anything the retired features left behind,
        // and the notice about them no longer applies to a fresh wallet.
        LegacyDataCleanup.purge()
        dismissRetiredFeaturesNotice()

        // Clear in-memory state
        credentials = []
        sessions = []
        requestLogs = []
        tokenAllowances = []
        tokenLedger = TokenUsageLedger()
        reservations = [:]
        groups = []
        appGroups = [:]
        installedApps = []
        UserDefaults.standard.removeObject(forKey: installedAppsKey)
        appConsent.clear()

        // Reset brute-force state
        resetFailedAttempts()

        AppGroupSync.shared.syncWalletState(isUnlocked: false, providers: [])
        status = .uninitialized
    }

    func dismissRetiredFeaturesNotice() {
        LegacyDataCleanup.dismissRetiredNotice()
        showRetiredFeaturesNotice = false
    }

    /// The notice is on screen: it won't come back on a later launch, but
    /// stays up for the rest of this session unless dismissed.
    func markRetiredFeaturesNoticeShown() {
        LegacyDataCleanup.markRetiredNoticeShown()
    }

    // MARK: - Installed Apps
    //
    // Web apps the user added by URL. They open in the in-wallet browser
    // (AppRuntimeView), where NativeBridgeHandler serves their requests with
    // the keys in this wallet.

    func loadInstalledApps() {
        guard let data = UserDefaults.standard.data(forKey: installedAppsKey),
              let apps = try? JSONDecoder().decode([InstalledApp].self, from: data) else { return }
        installedApps = apps
    }

    private func saveInstalledApps() {
        if let data = try? JSONEncoder().encode(installedApps) {
            UserDefaults.standard.set(data, forKey: installedAppsKey)
        }
    }

    /// Add a web app by URL. The input is normalized and must be https; when
    /// `name` is empty a name is derived from the host. Throws
    /// `InstalledApp.AddError` for invalid or already-added URLs.
    @discardableResult
    func addApp(urlString: String, name: String? = nil) throws -> InstalledApp {
        let app = try InstalledApp.make(from: urlString, name: name)
        if installedApps.contains(where: { $0.url == app.url }) {
            throw InstalledApp.AddError.duplicate
        }
        installedApps.append(app)
        saveInstalledApps()
        return app
    }

    func uninstallApp(_ id: String) {
        installedApps.removeAll { $0.id == id }
        saveInstalledApps()
    }

    func toggleApp(_ id: String) {
        if let idx = installedApps.firstIndex(where: { $0.id == id }) {
            installedApps[idx].enabled.toggle()
            saveInstalledApps()
        }
    }

    // MARK: - Backup (.byoky)

    /// Encrypt every credential into the contents of a `.byoky` file. Requires
    /// the wallet's master password again (an unlocked phone alone must not be
    /// enough to walk away with every key). Wrong attempts count toward the
    /// same lockout as unlocking. The PBKDF2-heavy work runs off the main
    /// actor; `progress` (0 → 1) is called from a background thread.
    func exportBackup(
        masterPassword: String,
        exportPassword: String,
        progress: @escaping @Sendable (Double) -> Void = { _ in }
    ) async throws -> String {
        guard masterKey != nil else { throw WalletError.locked }
        if let endTime = currentLockout().lockedUntil, Date() < endTime {
            lockoutEndTime = endTime
            throw WalletError.lockedOut(max(1, Int(endTime.timeIntervalSinceNow)))
        }
        let storedHash = try keychain.loadString(key: passwordHashKey)
        let verified = await Task.detached(priority: .userInitiated) {
            CryptoService.shared.verifyPassword(masterPassword, hash: storedHash)
        }.value
        guard verified else {
            handleFailedAttempt()
            throw WalletError.wrongPassword
        }
        resetFailedAttempts()
        guard masterKey != nil else { throw WalletError.locked }

        let entries = try credentials.map { credential in
            BackupFile.Entry(
                id: credential.id,
                providerId: credential.providerId,
                label: credential.label,
                authMethod: credential.authMethod,
                createdAt: credential.createdAt,
                baseUrl: credential.baseUrl,
                secret: try decryptKey(for: credential)
            )
        }
        return try await Task.detached(priority: .userInitiated) {
            try BackupFile.export(entries, password: exportPassword, progress: progress)
        }.value
    }

    /// A decrypted, validated backup waiting for the user to confirm.
    struct BackupImportPreview: Equatable {
        let contents: BackupFile.Contents
        /// What would be added right now (duplicates already removed).
        let toAdd: [BackupFile.Entry]
        let duplicates: Int
        var unsupported: Int { contents.unsupportedCount }
    }

    struct BackupImportSummary: Equatable {
        var added: Int
        var duplicates: Int
        var unsupported: Int
    }

    /// Step 1 of an import: decrypt and validate the file off the main actor
    /// and work out what would be added. Nothing is stored. Cancelling the
    /// calling task stops between keys.
    func prepareBackupImport(
        contents: String,
        password: String,
        progress: @escaping @Sendable (Double) -> Void = { _ in }
    ) async throws -> BackupImportPreview {
        guard masterKey != nil else { throw WalletError.locked }
        let work = Task.detached(priority: .userInitiated) {
            try BackupFile.open(contents, password: password, progress: progress)
        }
        let opened = try await withTaskCancellationHandler {
            try await work.value
        } onCancel: {
            work.cancel()
        }
        try Task.checkCancellation()
        let plan = BackupFile.plan(opened.entries, existing: try existingBackupEntries())
        return BackupImportPreview(contents: opened, toAdd: plan.toAdd, duplicates: plan.duplicateCount)
    }

    /// Step 2: store what the user confirmed. The merge is recomputed against
    /// the wallet as it is now; new keys get fresh ids, duplicates are
    /// skipped, nothing existing is changed or removed, and either every new
    /// key is stored or none is.
    func commitBackupImport(_ preview: BackupImportPreview) throws -> BackupImportSummary {
        guard let key = masterKey else { throw WalletError.locked }
        let plan = BackupFile.plan(preview.contents.entries, existing: try existingBackupEntries())

        let original = credentials
        var added: [Credential] = []
        var writtenKeys: [String] = []
        do {
            for entry in plan.toAdd {
                let credential = Credential(
                    id: UUID().uuidString,
                    providerId: entry.providerId,
                    label: entry.label,
                    authMethod: entry.authMethod,
                    createdAt: entry.createdAt,
                    baseUrl: entry.baseUrl
                )
                if !entry.secret.isEmpty {
                    let encrypted = try crypto.encrypt(plaintext: entry.secret, key: key)
                    try keychain.saveString(key: "key_\(credential.id)", value: "v2:" + encrypted)
                    writtenKeys.append(credential.id)
                }
                added.append(credential)
            }
            if !added.isEmpty {
                credentials = original + added
                try saveCredentials()
            }
        } catch {
            // Put the credential index back exactly as it was, so a failed
            // write can't lose existing keys, then drop the new key entries.
            credentials = original
            try? keychain.saveCodable(key: credentialsKey, value: original)
            for id in writtenKeys { try? keychain.delete(key: "key_\(id)") }
            throw error
        }

        if !added.isEmpty {
            AppGroupSync.shared.syncWalletState(
                isUnlocked: true,
                providers: credentials.map(\.providerId)
            )
        }
        return BackupImportSummary(
            added: added.count,
            duplicates: plan.duplicateCount,
            unsupported: preview.unsupported
        )
    }

    /// The wallet's keys in backup form, for duplicate detection. A stored
    /// key that can't be read can't be matched; it doesn't block the import.
    private func existingBackupEntries() throws -> [BackupFile.Entry] {
        guard masterKey != nil else { throw WalletError.locked }
        return credentials.compactMap { credential in
            guard let secret = try? decryptKey(for: credential) else { return nil }
            return BackupFile.Entry(
                providerId: credential.providerId,
                label: credential.label,
                authMethod: credential.authMethod,
                createdAt: credential.createdAt,
                baseUrl: Provider.find(credential.providerId)?.requiresCustomBaseUrl == true ? credential.baseUrl : nil,
                secret: secret
            )
        }
    }

    /// Called when the system hands Byoky a `.byoky` file. Reads it right away
    /// and queues the import sheet. The incoming copy is deleted afterwards
    /// when it lives in this app's own container (Documents/Inbox,
    /// tmp/<bundle>-Inbox, …); files elsewhere are never touched.
    func receiveBackupFile(at url: URL) {
        defer {
            if Self.isInsideAppContainer(url) {
                try? FileManager.default.removeItem(at: url)
            }
        }
        do {
            let contents = try BackupFile.readFile(at: url)
            pendingBackupFile = PendingBackupFile(fileName: url.lastPathComponent, contents: contents)
        } catch {
            pendingBackupFile = PendingBackupFile(fileName: url.lastPathComponent, contents: "", readError: error.localizedDescription)
        }
    }

    nonisolated static func isInsideAppContainer(_ url: URL, home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> Bool {
        guard url.isFileURL else { return false }
        let path = url.standardizedFileURL.resolvingSymlinksInPath().path
        let root = home.standardizedFileURL.resolvingSymlinksInPath().path
        return path.hasPrefix(root.hasSuffix("/") ? root : root + "/")
    }

    // MARK: - Brute-Force Protection

    /// The stored lockout state, merged with the in-memory copy (whichever
    /// counts more wins, so neither a failed read nor a stale copy can lower
    /// the count).
    private func currentLockout() -> UnlockLockout {
        if let stored = try? keychain.loadCodable(key: unlockLockoutKey, as: UnlockLockout.self) {
            unlockLockout = unlockLockout.merged(with: stored)
        }
        return unlockLockout
    }

    private func saveLockout(_ lockout: UnlockLockout) {
        unlockLockout = lockout
        try? keychain.saveCodable(key: unlockLockoutKey, value: lockout)
    }

    private func handleFailedAttempt() {
        var lockout = currentLockout()
        lockout.failedAttempts += 1
        if let duration = lockoutDuration(for: lockout.failedAttempts) {
            lockout.lockedUntil = Date().addingTimeInterval(duration)
            lockoutEndTime = lockout.lockedUntil
        }
        saveLockout(lockout)
    }

    private func resetFailedAttempts() {
        unlockLockout = UnlockLockout()
        lockoutEndTime = nil
        try? keychain.delete(key: unlockLockoutKey)
        // A copy the migration couldn't move yet would otherwise come back.
        UserDefaults.standard.removeObject(forKey: Self.legacyFailedAttemptsKey)
        UserDefaults.standard.removeObject(forKey: Self.legacyLockoutEndKey)
    }

    /// Earlier builds kept the counter in UserDefaults. Carry it over once,
    /// then drop it there.
    private func migrateLegacyLockout() {
        let defaults = UserDefaults.standard
        let attempts = defaults.integer(forKey: Self.legacyFailedAttemptsKey)
        let endTime = defaults.double(forKey: Self.legacyLockoutEndKey)
        guard attempts > 0 || endTime > 0 else { return }
        let legacy = UnlockLockout(
            failedAttempts: attempts,
            lockedUntil: endTime > 0 ? Date(timeIntervalSince1970: endTime) : nil
        )
        let merged = currentLockout().merged(with: legacy)
        unlockLockout = merged
        if (try? keychain.saveCodable(key: unlockLockoutKey, value: merged)) != nil {
            defaults.removeObject(forKey: Self.legacyFailedAttemptsKey)
            defaults.removeObject(forKey: Self.legacyLockoutEndKey)
        }
    }

    private func lockoutDuration(for attempts: Int) -> TimeInterval? {
        if attempts < 5 { return nil }
        if attempts < 10 { return 30 }
        if attempts < 15 { return 300 }
        return 1800
    }

    // MARK: - Auto-Lock
    //
    // The wallet locks after `autoLockTimeout` without activity: a touch
    // anywhere in the app (RootView) or a request from an app in the
    // in-wallet browser. Time in the background counts as idle.

    /// Restart the idle clock.
    func noteActivity() {
        guard status == .unlocked else { return }
        lastActivity = Date()
    }

    func recordBackgroundTime() {
        if status == .unlocked {
            backgroundTime = Date()
        }
    }

    /// Back in the foreground: lock if the wallet sat idle (or in the
    /// background) longer than the timeout. The idle timer can't fire while
    /// the app is suspended.
    func checkAutoLock() {
        defer { backgroundTime = nil }
        guard status == .unlocked else { return }
        let now = Date()
        let idle = now.timeIntervalSince(lastActivity)
        let away = backgroundTime.map { now.timeIntervalSince($0) } ?? 0
        if idle > autoLockTimeout || away > autoLockTimeout {
            lock()
        }
    }

    private func startIdleTimer() {
        lastActivity = Date()
        idleLockTask?.cancel()
        idleLockTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.status == .unlocked else { return }
                let remaining = self.autoLockTimeout - Date().timeIntervalSince(self.lastActivity)
                if remaining <= 0 {
                    self.lock()
                    return
                }
                try? await Task.sleep(for: .seconds(remaining))
            }
        }
    }

    private func stopIdleTimer() {
        idleLockTask?.cancel()
        idleLockTask = nil
    }

    // MARK: - Credentials

    func addCredential(providerId: String, label: String, apiKey: String, authMethod: AuthMethod = .apiKey, baseUrl: String? = nil) throws {
        guard let key = masterKey else { throw WalletError.locked }

        let credential = Credential.create(providerId: providerId, label: label, authMethod: authMethod, baseUrl: baseUrl)
        // Local providers may legitimately have an empty key (unauthenticated
        // server). Only encrypt + store ciphertext when a key was supplied.
        if !apiKey.isEmpty {
            let encrypted = try crypto.encrypt(plaintext: apiKey, key: key)
            try keychain.saveString(key: "key_\(credential.id)", value: "v2:" + encrypted)
        }

        credentials.append(credential)
        try saveCredentials()

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )
    }

    func updateCredentialLabel(id: String, newLabel: String) throws {
        let trimmed = newLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw WalletError.invalidInput }
        guard let idx = credentials.firstIndex(where: { $0.id == id }) else { return }
        guard credentials[idx].label != trimmed else { return }
        credentials[idx].label = trimmed
        try saveCredentials()
    }

    /// Set the endpoint / server URL of an Azure, Ollama or LM Studio
    /// credential (e.g. an Azure key added before endpoints were required).
    func updateCredentialEndpoint(id: String, endpoint: String) throws {
        guard let idx = credentials.firstIndex(where: { $0.id == id }) else { throw WalletError.credentialNotFound }
        guard let normalized = Provider.normalizedEndpoint(endpoint, for: credentials[idx].providerId) else {
            throw WalletError.invalidEndpoint
        }
        credentials[idx].baseUrl = normalized
        try saveCredentials()
    }

    func removeCredential(_ credential: Credential) throws {
        try keychain.delete(key: "key_\(credential.id)")
        credentials.removeAll { $0.id == credential.id }
        try saveCredentials()
        // A group pinned to this key falls back to any key of its provider,
        // like the extension does; a stale pin would fail every request.
        try clearStaleCredentialPins()

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )
    }

    func decryptKey(for credential: Credential) throws -> String {
        guard let key = masterKey else { throw WalletError.locked }

        // Local providers (Ollama, LM Studio) may be stored with no key at
        // all — their keychain entry is absent rather than empty. Return ""
        // so callers that just feed this into applyAuth get the "no auth"
        // path instead of a CryptoError.invalidData blowup.
        let isLocalProvider = credential.providerId == "ollama" || credential.providerId == "lm_studio"
        guard let encrypted = try? keychain.loadString(key: "key_\(credential.id)") else {
            if isLocalProvider { return "" }
            throw CryptoError.invalidData
        }

        guard encrypted.hasPrefix("v2:") else {
            throw CryptoError.invalidData
        }

        return try crypto.decrypt(encoded: String(encrypted.dropFirst(3)), key: key)
    }

    // MARK: - Migration

    /// Drop any stored credentials that reference providers we've removed from
    /// the registry (e.g. replicate, huggingface, the legacy "azure-openai" id).
    /// Runs once per unlock; cheap if there's nothing to do.
    private func pruneRemovedProviders() throws {
        let stale = credentials.filter { Provider.removedProviderIds.contains($0.providerId) }
        guard !stale.isEmpty else { return }
        for credential in stale {
            try? keychain.delete(key: "key_\(credential.id)")
        }
        credentials.removeAll { Provider.removedProviderIds.contains($0.providerId) }
        try saveCredentials()
    }

    private func migrateCredentials(password: String) throws {
        guard let key = masterKey else { return }

        for credential in credentials {
            let encrypted: String
            do {
                encrypted = try keychain.loadString(key: "key_\(credential.id)")
            } catch {
                continue
            }

            if encrypted.hasPrefix("v2:") { continue }

            let plaintext = try crypto.decryptLegacy(encoded: encrypted, password: password)
            let reEncrypted = try crypto.encrypt(plaintext: plaintext, key: key)
            try keychain.saveString(key: "key_\(credential.id)", value: "v2:" + reEncrypted)
        }
    }

    // MARK: - Sessions

    /// Default expiry window for connected-app sessions. An app stays in the
    /// Connected Apps screen for 30 days after it last connected — the user
    /// revokes explicitly when they're done. Lines up with how the extension
    /// treats sessions as durable trust records, not live connections.
    private static let sessionTTL: TimeInterval = 30 * 24 * 60 * 60

    /// Upsert a session for `appOrigin`. Called by `NativeBridgeHandler` when
    /// an app in the in-wallet browser connects, so it shows up in Connected
    /// Apps across launches. Reconnecting the same origin updates the
    /// providers list and resets the expiry, but keeps the existing session id.
    @discardableResult
    func upsertSession(appOrigin: String, providers: [String]) throws -> Session {
        let now = Date()
        let expiresAt = now.addingTimeInterval(Self.sessionTTL)

        if let idx = sessions.firstIndex(where: { $0.appOrigin == appOrigin }) {
            let existing = sessions[idx]
            let updated = Session(
                id: existing.id,
                appOrigin: appOrigin,
                sessionKey: existing.sessionKey,
                providers: providers,
                createdAt: existing.createdAt,
                expiresAt: expiresAt
            )
            sessions[idx] = updated
            try saveSessions()
            return updated
        }

        let session = Session(
            id: UUID().uuidString,
            appOrigin: appOrigin,
            sessionKey: UUID().uuidString,
            providers: providers,
            createdAt: now,
            expiresAt: expiresAt
        )
        sessions.append(session)
        try saveSessions()
        return session
    }

    /// User revoked an app in Connected Apps: drop its session and block
    /// reconnects from that origin until the user confirms "Reconnect" when
    /// opening the app again (`needsReapproval` / `grantAppAccess`).
    func revokeSession(_ session: Session) throws {
        appConsent.revoke(session.appOrigin)
        sessions.removeAll { $0.id == session.id }
        try saveSessions()
    }

    /// The app itself disconnected (BYOKY_DISCONNECT): end the session, but
    /// don't block it from connecting again.
    func endSession(appOrigin: String) {
        guard sessions.contains(where: { $0.appOrigin == appOrigin }) else { return }
        sessions.removeAll { $0.appOrigin == appOrigin }
        try? saveSessions()
    }

    /// The user confirmed "Reconnect" for a revoked app: it may connect again.
    func grantAppAccess(origin: String) {
        appConsent.grant(origin)
    }

    /// Opening `app` must ask "Reconnect?" first: the user revoked its origin
    /// in Connected Apps. Apps that disconnected themselves open as usual.
    func needsReapproval(_ app: InstalledApp) -> Bool {
        appConsent.needsReapproval(appURL: app.url)
    }

    func isAppAccessRevoked(origin: String) -> Bool {
        appConsent.isRevoked(origin)
    }

    /// The app has a live (connected, unexpired) session.
    func hasActiveSession(appOrigin: String) -> Bool {
        sessions.contains { $0.appOrigin == appOrigin && !$0.isExpired }
    }

    func cleanExpiredSessions() throws {
        sessions.removeAll { $0.isExpired }
        try saveSessions()
    }

    // MARK: - Token Allowances
    //
    // Usage is counted in `tokenLedger` (per app and provider). Each request
    // holds a reservation while it runs, so parallel requests can't all start
    // on the same remaining allowance.

    func setAllowance(_ allowance: TokenAllowance) {
        if let idx = tokenAllowances.firstIndex(where: { $0.origin == allowance.origin }) {
            tokenAllowances[idx] = allowance
        } else {
            tokenAllowances.append(allowance)
        }
        saveTokenAllowances()
    }

    func removeAllowance(origin: String) {
        tokenAllowances.removeAll { $0.origin == origin }
        saveTokenAllowances()
    }

    /// Whether `origin` may start another `providerId` request: tokens
    /// counted so far plus those held by its requests still in flight.
    func checkAllowance(origin: String, providerId: String) -> AllowanceCheck {
        let held = reservations.values.filter { $0.origin == origin }
        return AllowanceCheck.compute(
            allowance: tokenAllowances.first { $0.origin == origin },
            totalUsed: tokenLedger.total(origin: origin) + held.reduce(0) { $0 + $1.tokens },
            providerUsed: tokenLedger.used(origin: origin, providerId: providerId)
                + held.filter { $0.providerId == providerId }.reduce(0) { $0 + $1.tokens },
            providerId: providerId
        )
    }

    /// Check the allowance and, if the request may go ahead, hold
    /// `estimatedTokens` for it until `settleReservation`.
    func reserveTokens(origin: String, providerId: String, estimatedTokens: Int) -> Result<TokenReservation, AllowanceExceeded> {
        let check = checkAllowance(origin: origin, providerId: providerId)
        guard check.allowed else {
            return .failure(AllowanceExceeded(reason: check.reason ?? "Token allowance exceeded"))
        }
        let reservation = TokenReservation(origin: origin, providerId: providerId, tokens: max(0, estimatedTokens))
        reservations[reservation.id] = reservation
        return .success(reservation)
    }

    /// The request is over: release its hold and count what it used.
    func settleReservation(_ reservation: TokenReservation, usedTokens: Int) {
        reservations[reservation.id] = nil
        guard usedTokens > 0 else { return }
        if masterKey != nil {
            tokenLedger.add(usedTokens, origin: reservation.origin, providerId: reservation.providerId)
            saveTokenLedger()
        } else if var stored = try? keychain.loadCodable(key: tokenLedgerKey, as: TokenUsageLedger.self) {
            // Locked while the request ran: count it in the stored ledger
            // without bringing any state back into memory.
            stored.add(usedTokens, origin: reservation.origin, providerId: reservation.providerId)
            try? keychain.saveCodable(key: tokenLedgerKey, value: stored)
        }
    }

    func tokenUsage(for origin: String) -> Int {
        tokenLedger.total(origin: origin)
    }

    // MARK: - Persistence

    private func loadCredentials() throws {
        do {
            credentials = try keychain.loadCodable(key: credentialsKey, as: [Credential].self)
        } catch KeychainError.loadFailed {
            credentials = []
        }
    }

    private func saveCredentials() throws {
        try keychain.saveCodable(key: credentialsKey, value: credentials)
    }

    private func loadSessions() throws {
        do {
            sessions = try keychain.loadCodable(key: sessionsKey, as: [Session].self)
            try cleanExpiredSessions()
        } catch KeychainError.loadFailed {
            sessions = []
        }
    }

    private func saveSessions() throws {
        try keychain.saveCodable(key: sessionsKey, value: sessions)
    }

    // MARK: - Request Logging

    /// Record a finished request. Does nothing once the wallet is locked: the
    /// in-memory log is empty then, and saving it would wipe the stored one.
    func logRequest(
        appOrigin: String,
        providerId: String,
        method: String,
        url: String,
        statusCode: Int,
        requestBody: Data?,
        usage: UsageParser.TokenUsage?,
        actualProviderId: String? = nil,
        actualModel: String? = nil,
        groupId: String? = nil
    ) {
        guard masterKey != nil else { return }
        var sanitizedUrl = url
        if let comps = URLComponents(string: url) {
            var clean = comps
            clean.query = nil
            sanitizedUrl = clean.string ?? url
        }

        var entry = RequestLog(
            id: UUID().uuidString,
            appOrigin: appOrigin,
            providerId: providerId,
            method: method,
            url: sanitizedUrl,
            statusCode: statusCode,
            timestamp: Date()
        )

        entry.model = UsageParser.parseModel(from: requestBody)
        entry.inputTokens = usage?.inputTokens
        entry.outputTokens = usage?.outputTokens

        entry.actualProviderId = actualProviderId
        entry.actualModel = actualModel
        entry.groupId = groupId

        // Tag the entry with the capability fingerprint of the source request
        // body (tools / vision / structured output / extended reasoning). The
        // Apps screen aggregates these per-app to warn before moving an app
        // to a group whose model lacks one of those features.
        entry.usedCapabilities = TranslationEngine.shared.detectRequestCapabilities(body: requestBody)

        requestLogs.insert(entry, at: 0)
        if requestLogs.count > 500 {
            requestLogs = Array(requestLogs.prefix(500))
        }
        saveRequestLogs()
    }

    private func loadRequestLogs() {
        do {
            requestLogs = try keychain.loadCodable(key: requestLogKey, as: [RequestLog].self)
        } catch {
            requestLogs = []
        }
    }

    private func saveRequestLogs() {
        try? keychain.saveCodable(key: requestLogKey, value: requestLogs)
    }

    private func loadTokenAllowances() {
        do {
            tokenAllowances = try keychain.loadCodable(key: tokenAllowancesKey, as: [TokenAllowance].self)
        } catch {
            tokenAllowances = []
        }
    }

    private func saveTokenAllowances() {
        try? keychain.saveCodable(key: tokenAllowancesKey, value: tokenAllowances)
    }

    /// Load the usage ledger. The first time (no ledger stored yet) it starts
    /// from the usage still in the request log and is saved right away, so a
    /// request that ends after a lock always finds one to add to.
    private func loadTokenLedger() {
        if let stored = try? keychain.loadCodable(key: tokenLedgerKey, as: TokenUsageLedger.self) {
            tokenLedger = stored
        } else {
            tokenLedger = TokenUsageLedger.seeded(from: requestLogs)
            saveTokenLedger()
        }
    }

    private func saveTokenLedger() {
        try? keychain.saveCodable(key: tokenLedgerKey, value: tokenLedger)
    }

    // MARK: - Groups
    //
    // Groups are routing rules. Each app origin is bound to a group via
    // `appGroups` (origin → groupId), set from the Connected Apps screen. The
    // default group catches anything not explicitly bound. RoutingResolver
    // looks up `groupForOrigin(_:)` on every request to decide credentials +
    // (when cross-family) translation destination.

    private func loadGroups() {
        do {
            groups = try keychain.loadCodable(key: groupsKey, as: [Group].self)
        } catch {
            groups = []
        }
    }

    private func saveGroups() throws {
        try keychain.saveCodable(key: groupsKey, value: groups)
    }

    private func loadAppGroups() {
        do {
            appGroups = try keychain.loadCodable(key: appGroupsKey, as: AppGroups.self)
        } catch {
            appGroups = [:]
        }
    }

    private func saveAppGroups() throws {
        try keychain.saveCodable(key: appGroupsKey, value: appGroups)
    }

    /// Drop group pins to keys that no longer exist (removed here, or left
    /// behind by older builds). The group then uses any key of its provider.
    private func clearStaleCredentialPins() throws {
        let ids = Set(credentials.map(\.id))
        var changed = false
        for idx in groups.indices {
            if let pinned = groups[idx].credentialId, !ids.contains(pinned) {
                groups[idx].credentialId = nil
                changed = true
            }
        }
        if changed { try saveGroups() }
    }

    /// Make sure the default group exists as a routing-neutral sentinel.
    /// Apps with no explicit binding land here; the resolver sees an empty
    /// providerId and falls through to direct credential lookup.
    private func ensureDefaultGroup() throws {
        if let idx = groups.firstIndex(where: { $0.id == defaultGroupId }) {
            // Migrate stale default groups that were auto-populated with a
            // provider binding (pre-sentinel behavior).
            if !groups[idx].providerId.isEmpty || groups[idx].credentialId != nil {
                groups[idx].providerId = ""
                groups[idx].credentialId = nil
                try saveGroups()
            }
            return
        }
        groups.insert(Group.makeDefault(), at: 0)
        try saveGroups()
    }

    /// Returns the group that should route this origin's requests — the user's
    /// per-app binding from `appGroups`, falling back to the default group when
    /// no binding exists. Used by `NativeBridgeHandler` before each upstream call.
    func groupForOrigin(_ origin: String) -> Group? {
        if let bound = appGroups[origin], let group = groups.first(where: { $0.id == bound }) {
            return group
        }
        return groups.first(where: { $0.id == defaultGroupId })
    }

    /// Bind an app origin to a group. Called from the Connected Apps screen
    /// when the user assigns an app to a group (the per-app routing knob).
    /// `RoutingResolver` picks this up on the next request via
    /// `groupForOrigin(_:)` — no other plumbing required.
    func setAppGroup(origin: String, groupId: String) throws {
        guard groups.contains(where: { $0.id == groupId }) else { throw GroupError.notFound }
        appGroups[origin] = groupId
        try saveAppGroups()
    }

    enum GroupError: LocalizedError {
        case nameInvalid
        case nameDuplicate
        case providerInvalid
        case credentialNotFound
        case credentialMismatch
        case notFound
        case cannotDeleteDefault

        var errorDescription: String? {
            switch self {
            case .nameInvalid: return "Group name must be 1–200 characters"
            case .nameDuplicate: return "A group with this name already exists"
            case .providerInvalid: return "Invalid provider"
            case .credentialNotFound: return "Credential not found"
            case .credentialMismatch: return "Credential does not match provider"
            case .notFound: return "Group not found"
            case .cannotDeleteDefault: return "Cannot delete the default group"
            }
        }
    }

    @discardableResult
    func createGroup(
        name: String,
        providerId: String,
        credentialId: String? = nil,
        model: String? = nil
    ) throws -> Group {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 200 else { throw GroupError.nameInvalid }
        guard Provider.find(providerId) != nil else { throw GroupError.providerInvalid }
        if let credentialId {
            guard let cred = credentials.first(where: { $0.id == credentialId }) else { throw GroupError.credentialNotFound }
            guard cred.providerId == providerId else { throw GroupError.credentialMismatch }
        }
        if groups.contains(where: { $0.name.lowercased() == trimmed.lowercased() }) {
            throw GroupError.nameDuplicate
        }
        let group = Group(
            id: UUID().uuidString,
            name: trimmed,
            providerId: providerId,
            credentialId: credentialId,
            model: model?.trimmingCharacters(in: .whitespaces).nilIfEmpty,
            createdAt: Date()
        )
        groups.append(group)
        try saveGroups()
        return group
    }

    @discardableResult
    func updateGroup(
        id: String,
        name: String? = nil,
        providerId: String? = nil,
        credentialId: String?? = nil, // double optional: nil = no change, .some(nil) = unset
        model: String?? = nil
    ) throws -> Group {
        guard let idx = groups.firstIndex(where: { $0.id == id }) else { throw GroupError.notFound }
        var next = groups[idx]

        if let name {
            let trimmed = name.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, trimmed.count <= 200 else { throw GroupError.nameInvalid }
            if id != defaultGroupId,
               groups.contains(where: { $0.id != id && $0.name.lowercased() == trimmed.lowercased() }) {
                throw GroupError.nameDuplicate
            }
            next.name = trimmed
        }
        if let providerId {
            guard Provider.find(providerId) != nil else { throw GroupError.providerInvalid }
            next.providerId = providerId
            // Provider change invalidates the pin unless this same patch sets one.
            if credentialId == nil { next.credentialId = nil }
        }
        if case .some(let value) = credentialId {
            if let value {
                guard let cred = credentials.first(where: { $0.id == value }) else { throw GroupError.credentialNotFound }
                guard cred.providerId == next.providerId else { throw GroupError.credentialMismatch }
                next.credentialId = value
            } else {
                next.credentialId = nil
            }
        }
        if case .some(let value) = model {
            next.model = value?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        }

        groups[idx] = next
        try saveGroups()
        return next
    }

    func deleteGroup(id: String) throws {
        guard id != defaultGroupId else { throw GroupError.cannotDeleteDefault }
        guard groups.contains(where: { $0.id == id }) else { throw GroupError.notFound }
        groups.removeAll { $0.id == id }
        try saveGroups()
        // Reassign any apps that pointed at this group back to the default.
        var reassigned = false
        for (origin, gid) in appGroups where gid == id {
            appGroups[origin] = defaultGroupId
            reassigned = true
        }
        if reassigned { try saveAppGroups() }
    }
}

/// Origins whose access the user revoked in Connected Apps. They can't
/// reconnect until the user opens the app again and confirms "Reconnect".
struct AppConsentStore {
    static let defaultsKey = "byoky_revokedAppOrigins"
    var defaults: UserDefaults = .standard

    func isRevoked(_ origin: String) -> Bool {
        revoked.contains(origin)
    }

    func revoke(_ origin: String) {
        var set = revoked
        set.insert(origin)
        defaults.set(Array(set).sorted(), forKey: Self.defaultsKey)
    }

    func grant(_ origin: String) {
        var set = revoked
        guard set.remove(origin) != nil else { return }
        defaults.set(Array(set).sorted(), forKey: Self.defaultsKey)
    }

    func clear() {
        defaults.removeObject(forKey: Self.defaultsKey)
    }

    /// The app at `appURL` belongs to a revoked origin, so opening it needs
    /// the user's explicit "Reconnect" first.
    func needsReapproval(appURL: String) -> Bool {
        guard let url = URL(string: appURL), url.host != nil else { return false }
        return isRevoked(InstalledApp.origin(of: url))
    }

    private var revoked: Set<String> {
        Set(defaults.stringArray(forKey: Self.defaultsKey) ?? [])
    }
}

/// A `.byoky` file picked or opened for import.
struct PendingBackupFile: Identifiable, Equatable {
    let id = UUID()
    let fileName: String
    let contents: String
    /// Set when the file couldn't be read (too large, not text, …).
    var readError: String?
}

enum WalletError: LocalizedError {
    case locked
    case wrongPassword
    case passwordHashFailed
    case credentialNotFound
    case lockedOut(Int)
    case invalidInput
    case invalidEndpoint

    var errorDescription: String? {
        switch self {
        case .locked: return "Wallet is locked"
        case .wrongPassword: return "Wrong password"
        case .passwordHashFailed: return "Failed to hash password"
        case .credentialNotFound: return "Credential not found"
        case .lockedOut(let seconds): return "Too many attempts. Try again in \(seconds)s"
        case .invalidInput: return "Invalid input"
        case .invalidEndpoint: return "Enter a valid endpoint address"
        }
    }
}
