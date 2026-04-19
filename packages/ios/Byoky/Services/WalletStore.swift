import Combine
import CryptoKit
import Foundation

@MainActor
final class WalletStore: ObservableObject {
    static let shared = WalletStore()

    @Published var status: WalletStatus = .uninitialized
    @Published var credentials: [Credential] = []
    @Published var sessions: [Session] = []
    @Published var requestLogs: [RequestLog] = []
    @Published var gifts: [Gift] = []
    @Published var giftedCredentials: [GiftedCredential] = []
    /// Last-known online status per received gift, keyed by giftId. Filled in
    /// by `probeGiftPeers()` which the Wallet screen calls on appear. Treated
    /// as transient — we don't persist it; if it's missing, the UI shows a
    /// "checking" state until the probe lands.
    @Published var giftPeerOnline: [String: Bool] = [:]
    @Published var giftPreferences: [String: String] = [:]  // providerId -> giftId
    @Published var tokenAllowances: [TokenAllowance] = []
    @Published var groups: [Group] = []
    @Published var appGroups: AppGroups = [:]
    @Published var lockoutEndTime: Date?
    @Published var installedApps: [InstalledApp] = []
    @Published var cloudVaultEnabled = false
    @Published var cloudVaultUsername: String?
    @Published var cloudVaultLastUsername: String?
    @Published var cloudVaultTokenExpired = false
    /// Set by ByokyApp.onOpenURL when a byoky://gift/<payload> deep link
    /// fires. WalletView observes this and presents the redeem sheet with
    /// the link pre-filled.
    @Published var pendingGiftLink: String?
    /// Set by ByokyApp.onOpenURL when a byoky://pair/<payload> deep link
    /// fires. MainTabView switches to the Connect tab and PairView auto-
    /// kicks off the relay handshake with the decoded payload.
    @Published var pendingPairLink: String?

    private let keychain = KeychainService.shared
    private let crypto = CryptoService.shared
    private var masterKey: SymmetricKey?

    private let passwordHashKey = "password_hash"
    private let masterSaltKey = "master_salt"
    private let credentialsKey = "credentials"
    private let sessionsKey = "sessions"
    private let requestLogKey = "requestLog"
    private let giftsKey = "gifts"
    private let giftedCredentialsKey = "giftedCredentials"
    private let giftPreferencesKey = "giftPreferences"
    private let tokenAllowancesKey = "tokenAllowances"
    private let groupsKey = "groups"
    private let appGroupsKey = "appGroups"
    private let installedAppsKey = "installedApps"

    private static let vaultURL = "https://vault.byoky.com"
    private var vaultToken: String?
    private var vaultSessionId: String?
    private var vaultTokenIssuedAt: Date?
    private var vaultCredentialMap: [String: String] = [:]
    // Per-credential sync metadata for last-write-wins merging. Parallel to
    // vaultCredentialMap so the two stay in lockstep; group sync still reads
    // the legacy map directly, but pullFromVault needs the remote updatedAt
    // to decide conflicts.
    private struct VaultCredentialMeta: Codable {
        let serverId: String
        let remoteUpdatedAt: Int64
    }
    private var vaultCredentialMeta: [String: VaultCredentialMeta] = [:]
    private var vaultLastSyncAt: Int64 = 0
    // AES-GCM key derived from (vault password, encryptionSalt). Used to
    // encrypt apiKey before upload and decrypt on sync pull, so plaintext
    // never crosses the wire. Held in memory after login; raw bytes are
    // persisted in the keychain for relock survival.
    private var vaultKey: SymmetricKey?

    private let autoLockTimeout: TimeInterval = 300
    private var backgroundTime: Date?

    private var failedAttempts: Int {
        get { UserDefaults.standard.integer(forKey: "byoky_failedUnlockAttempts") }
        set { UserDefaults.standard.set(newValue, forKey: "byoky_failedUnlockAttempts") }
    }

    private init() {
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
        let ts = UserDefaults.standard.double(forKey: "byoky_lockoutEndTime")
        guard ts > 0 else { return }
        let endTime = Date(timeIntervalSince1970: ts)
        if Date() < endTime {
            lockoutEndTime = endTime
        } else {
            UserDefaults.standard.set(0.0, forKey: "byoky_lockoutEndTime")
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
        status = .unlocked

        AppGroupSync.shared.syncWalletState(isUnlocked: true, providers: [])

        // Without this attach, gifts created before the user's first
        // lock+unlock cycle never open their sender-side relay socket —
        // recipients hit 503 GIFT_SENDER_OFFLINE. See COD-13.
        GiftRelayHost.shared.attach(wallet: self)
        GiftRelayHost.shared.reconnectAll()
    }

    func unlock(password: String) throws {
        if let endTime = lockoutEndTime, Date() < endTime {
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
        loadGifts()
        loadGiftedCredentials()
        loadGiftPreferences()
        loadTokenAllowances()
        loadGroups()
        loadAppGroups()
        try ensureDefaultGroup()
        try migrateCredentials(password: password)
        loadCloudVaultState()
        Task {
            if cloudVaultEnabled, vaultToken != nil, !cloudVaultTokenExpired {
                await pullFromVault()
            }
            await syncPendingCredentials()
            await syncPendingGroups()
            await syncPendingGifts()
            await reconcileGiftUsageWithVault()
        }

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )

        GiftRelayHost.shared.attach(wallet: self)
        GiftRelayHost.shared.reconnectAll()
    }

    func lock() {
        GiftRelayHost.shared.disconnectAll()
        masterKey = nil
        credentials = []
        sessions = []
        requestLogs = []
        gifts = []
        giftedCredentials = []
        giftPreferences = [:]
        tokenAllowances = []
        groups = []
        appGroups = [:]
        installedApps = []
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
        try? keychain.delete(key: giftsKey)
        try? keychain.delete(key: giftedCredentialsKey)
        try? keychain.delete(key: tokenAllowancesKey)
        try? keychain.delete(key: groupsKey)
        try? keychain.delete(key: appGroupsKey)
        clearCloudVaultState(clearLastUsername: true)

        // Clear in-memory state
        credentials = []
        sessions = []
        requestLogs = []
        gifts = []
        giftedCredentials = []
        tokenAllowances = []
        groups = []
        appGroups = [:]
        installedApps = []
        UserDefaults.standard.removeObject(forKey: installedAppsKey)

        // Reset brute-force state
        failedAttempts = 0
        lockoutEndTime = nil
        UserDefaults.standard.set(0.0, forKey: "byoky_lockoutEndTime")

        AppGroupSync.shared.syncWalletState(isUnlocked: false, providers: [])
        status = .uninitialized
    }

    // MARK: - Marketplace Apps

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

    func installApp(_ app: MarketplaceApp) {
        guard let url = URL(string: app.url), url.scheme == "https" else { return }

        let installed = InstalledApp(
            id: app.id,
            slug: app.slug,
            name: app.name,
            url: url.absoluteString,
            icon: app.icon,
            description: app.description,
            category: app.category,
            providers: app.providers,
            authorName: app.author.name,
            authorWebsite: app.author.website,
            verified: app.verified,
            installedAt: Date(),
            enabled: true
        )
        installedApps.append(installed)
        saveInstalledApps()
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

    // MARK: - Brute-Force Protection

    private func handleFailedAttempt() {
        failedAttempts += 1
        if let duration = lockoutDuration(for: failedAttempts) {
            let endTime = Date().addingTimeInterval(duration)
            lockoutEndTime = endTime
            UserDefaults.standard.set(endTime.timeIntervalSince1970, forKey: "byoky_lockoutEndTime")
        }
    }

    private func resetFailedAttempts() {
        failedAttempts = 0
        lockoutEndTime = nil
        UserDefaults.standard.set(0.0, forKey: "byoky_lockoutEndTime")
    }

    private func lockoutDuration(for attempts: Int) -> TimeInterval? {
        if attempts < 5 { return nil }
        if attempts < 10 { return 30 }
        if attempts < 15 { return 300 }
        return 1800
    }

    // MARK: - Auto-Lock

    func recordBackgroundTime() {
        if status == .unlocked {
            backgroundTime = Date()
        }
    }

    func checkAutoLock() {
        defer { backgroundTime = nil }
        guard status == .unlocked,
              let bg = backgroundTime,
              Date().timeIntervalSince(bg) > autoLockTimeout else { return }
        lock()
    }

    // MARK: - Credentials

    func addCredential(providerId: String, label: String, apiKey: String, authMethod: AuthMethod = .apiKey) throws {
        guard let key = masterKey else { throw WalletError.locked }

        let credential = Credential.create(providerId: providerId, label: label, authMethod: authMethod)
        let encrypted = try crypto.encrypt(plaintext: apiKey, key: key)

        try keychain.saveString(key: "key_\(credential.id)", value: "v2:" + encrypted)

        credentials.append(credential)
        try saveCredentials()

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )

        let localId = credential.id
        Task { await syncAddToVault(localId: localId, providerId: providerId, label: label, authMethod: authMethod.rawValue, plainKey: apiKey) }
    }

    func updateCredentialLabel(id: String, newLabel: String) throws {
        let trimmed = newLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw WalletError.invalidInput }
        guard let idx = credentials.firstIndex(where: { $0.id == id }) else { return }
        guard credentials[idx].label != trimmed else { return }
        credentials[idx].label = trimmed
        try saveCredentials()
        Task { await syncRenameToVault(localId: id, newLabel: trimmed) }
    }

    func removeCredential(_ credential: Credential) throws {
        let localId = credential.id
        try keychain.delete(key: "key_\(credential.id)")
        credentials.removeAll { $0.id == credential.id }
        try saveCredentials()

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )

        Task { await syncRemoveFromVault(localId: localId) }
    }

    func decryptKey(for credential: Credential) throws -> String {
        guard let key = masterKey else { throw WalletError.locked }
        let encrypted = try keychain.loadString(key: "key_\(credential.id)")

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

    /// Default expiry window for relay-paired sessions. The pair stays in the
    /// Apps screen for 30 days even if the WebSocket drops between requests —
    /// the user revokes explicitly when they're done. Lines up with how the
    /// extension treats sessions as durable trust records, not live sockets.
    private static let relaySessionTTL: TimeInterval = 30 * 24 * 60 * 60

    /// Upsert a session for `appOrigin`. Used by `RelayPairService` when a
    /// pair handshake completes — durable record so the app shows up in the
    /// Apps screen across reconnects. Re-pairing the same origin updates the
    /// providers list and resets the expiry, but keeps the existing session id.
    @discardableResult
    func upsertSession(appOrigin: String, providers: [String]) throws -> Session {
        let now = Date()
        let expiresAt = now.addingTimeInterval(Self.relaySessionTTL)

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

    func revokeSession(_ session: Session) throws {
        sessions.removeAll { $0.id == session.id }
        try saveSessions()
    }

    func cleanExpiredSessions() throws {
        sessions.removeAll { $0.isExpired }
        try saveSessions()
    }

    // MARK: - Token Allowances

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

    func checkAllowance(origin: String, providerId: String) -> AllowanceCheck {
        let allowance = tokenAllowances.first { $0.origin == origin }
        let entries = requestLogs.filter { $0.appOrigin == origin && $0.statusCode < 400 }
        return AllowanceCheck.compute(allowance: allowance, entries: entries, providerId: providerId)
    }

    func tokenUsage(for origin: String) -> Int {
        requestLogs
            .filter { $0.appOrigin == origin && $0.statusCode < 400 }
            .reduce(0) { $0 + ($1.inputTokens ?? 0) + ($1.outputTokens ?? 0) }
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

    func logRequest(
        appOrigin: String,
        providerId: String,
        method: String,
        url: String,
        statusCode: Int,
        requestBody: Data?,
        responseBody: String?,
        actualProviderId: String? = nil,
        actualModel: String? = nil,
        groupId: String? = nil
    ) {
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

        if let responseBody {
            // Use the upstream provider for usage parsing if we routed
            // cross-family — the response body shape matches the destination
            // provider, not the source.
            let parseProviderId = actualProviderId ?? providerId
            let usage = UsageParser.parseUsage(providerId: parseProviderId, body: responseBody)
            entry.inputTokens = usage?.inputTokens
            entry.outputTokens = usage?.outputTokens
        }

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

    // MARK: - Groups
    //
    // Groups are routing rules. Each app origin is bound to a group via
    // `appGroups` (origin → groupId), set from the Apps screen. The default
    // group catches anything not explicitly bound. RoutingResolver looks up
    // `groupForOrigin(_:)` on every request to decide credentials + (when
    // cross-family) translation destination.

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
    /// no binding exists. Used by `RelayPairService` before each upstream call.
    func groupForOrigin(_ origin: String) -> Group? {
        if let bound = appGroups[origin], let group = groups.first(where: { $0.id == bound }) {
            return group
        }
        return groups.first(where: { $0.id == defaultGroupId })
    }

    /// Bind an app origin to a group. Called from the Apps screen when the
    /// user assigns a connected app to a group (the per-app routing knob).
    /// `RoutingResolver` picks this up on the next request via
    /// `groupForOrigin(_:)` — no other plumbing required.
    func setAppGroup(origin: String, groupId: String) throws {
        guard groups.contains(where: { $0.id == groupId }) else { throw GroupError.notFound }
        appGroups[origin] = groupId
        try saveAppGroups()
        Task { await syncAppGroupToVault(origin: origin, groupId: groupId) }
    }

    enum GroupError: LocalizedError {
        case nameInvalid
        case nameDuplicate
        case providerInvalid
        case credentialNotFound
        case credentialMismatch
        case giftNotFound
        case giftMismatch
        case pinConflict
        case notFound
        case cannotDeleteDefault

        var errorDescription: String? {
            switch self {
            case .nameInvalid: return "Group name must be 1–200 characters"
            case .nameDuplicate: return "A group with this name already exists"
            case .providerInvalid: return "Invalid provider"
            case .credentialNotFound: return "Credential not found"
            case .credentialMismatch: return "Credential does not match provider"
            case .giftNotFound: return "Gift not found"
            case .giftMismatch: return "Gift does not match provider"
            case .pinConflict: return "Credential and gift are mutually exclusive"
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
        giftId: String? = nil,
        model: String? = nil
    ) throws -> Group {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 200 else { throw GroupError.nameInvalid }
        guard Provider.find(providerId) != nil else { throw GroupError.providerInvalid }
        if credentialId != nil && giftId != nil {
            throw GroupError.pinConflict
        }
        if let credentialId {
            guard let cred = credentials.first(where: { $0.id == credentialId }) else { throw GroupError.credentialNotFound }
            guard cred.providerId == providerId else { throw GroupError.credentialMismatch }
        }
        if let giftId {
            guard let gc = giftedCredentials.first(where: { $0.giftId == giftId }) else { throw GroupError.giftNotFound }
            guard gc.providerId == providerId else { throw GroupError.giftMismatch }
        }
        if groups.contains(where: { $0.name.lowercased() == trimmed.lowercased() }) {
            throw GroupError.nameDuplicate
        }
        let group = Group(
            id: UUID().uuidString,
            name: trimmed,
            providerId: providerId,
            credentialId: credentialId,
            giftId: giftId,
            model: model?.trimmingCharacters(in: .whitespaces).nilIfEmpty,
            createdAt: Date()
        )
        groups.append(group)
        try saveGroups()
        Task { await syncGroupToVault(group) }
        return group
    }

    @discardableResult
    func updateGroup(
        id: String,
        name: String? = nil,
        providerId: String? = nil,
        credentialId: String?? = nil, // double optional: nil = no change, .some(nil) = unset
        giftId: String?? = nil,       // same sentinel convention as credentialId
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
            // Provider change invalidates both pins unless this same patch sets one.
            if credentialId == nil { next.credentialId = nil }
            if giftId == nil { next.giftId = nil }
        }
        if case .some(let value) = credentialId {
            if let value {
                guard let cred = credentials.first(where: { $0.id == value }) else { throw GroupError.credentialNotFound }
                guard cred.providerId == next.providerId else { throw GroupError.credentialMismatch }
                next.credentialId = value
                // Setting a credential pin clears any gift pin (mutual exclusion).
                next.giftId = nil
            } else {
                next.credentialId = nil
            }
        }
        if case .some(let value) = giftId {
            if let value {
                guard let gc = giftedCredentials.first(where: { $0.giftId == value }) else { throw GroupError.giftNotFound }
                guard gc.providerId == next.providerId else { throw GroupError.giftMismatch }
                next.giftId = value
                // Setting a gift pin clears any credential pin (mutual exclusion).
                next.credentialId = nil
            } else {
                next.giftId = nil
            }
        }
        if case .some(let value) = model {
            next.model = value?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        }

        groups[idx] = next
        try saveGroups()
        Task { await syncGroupToVault(next) }
        return next
    }

    func deleteGroup(id: String) throws {
        guard id != defaultGroupId else { throw GroupError.cannotDeleteDefault }
        guard groups.contains(where: { $0.id == id }) else { throw GroupError.notFound }
        groups.removeAll { $0.id == id }
        try saveGroups()
        // Reassign any apps that pointed at this group back to the default.
        var reassignedOrigins: [String] = []
        for (origin, gid) in appGroups where gid == id {
            appGroups[origin] = defaultGroupId
            reassignedOrigins.append(origin)
        }
        if !reassignedOrigins.isEmpty { try saveAppGroups() }
        Task {
            await syncGroupDeleteToVault(groupId: id)
            for origin in reassignedOrigins {
                await syncAppGroupToVault(origin: origin, groupId: defaultGroupId)
            }
        }
    }

    // MARK: - Gifts (Sender)

    func createGift(
        credentialId: String,
        providerId: String,
        label: String,
        maxTokens: Int,
        expiresInMs: TimeInterval,
        relayUrl: String
    ) -> Gift {
        let gift = Gift(
            id: UUID().uuidString,
            credentialId: credentialId,
            providerId: providerId,
            label: label,
            authToken: generateSecureToken(),
            maxTokens: maxTokens,
            usedTokens: 0,
            expiresAt: Date(timeIntervalSinceNow: expiresInMs / 1000),
            createdAt: Date(),
            active: true,
            relayUrl: relayUrl
        )
        gifts.append(gift)
        saveGifts()
        GiftRelayHost.shared.connect(gift: gift)
        Task { await registerGiftWithVault(gift) }
        return gift
    }

    func revokeGift(id: String) {
        guard let index = gifts.firstIndex(where: { $0.id == id }) else { return }
        let mgmtToken = gifts[index].marketplaceManagementToken
        gifts[index].active = false
        saveGifts()
        GiftRelayHost.shared.disconnect(giftId: id)
        Task { await unregisterGiftFromVault(giftId: id) }
        if let mgmtToken {
            Task { await unlistMarketplaceGift(giftId: id, token: mgmtToken) }
        }
    }

    /// Increment `gifts[giftId].usedTokens` from the sender-side gift relay
    /// after a successful proxied request. Clamps to `maxTokens` and returns
    /// the new value, or `nil` if the gift is gone / already at its cap.
    func addGiftSenderUsage(giftId: String, tokens: Int) -> Int? {
        guard tokens > 0,
              let idx = gifts.firstIndex(where: { $0.id == giftId }) else {
            return nil
        }
        let current = gifts[idx].usedTokens
        let cap = gifts[idx].maxTokens
        if current >= cap { return nil }
        let next = min(cap, current + tokens)
        gifts[idx].usedTokens = next
        saveGifts()
        return next
    }

    func redeemGift(encoded: String) throws {
        let link = try decodeGiftLink(encoded)
        try validateGiftLink(link)

        if giftedCredentials.contains(where: { $0.giftId == link.id }) {
            throw GiftError.alreadyRedeemed
        }

        let credential = GiftedCredential(
            id: UUID().uuidString,
            giftId: link.id,
            providerId: link.p,
            providerName: link.n,
            senderLabel: link.s,
            authToken: link.t,
            maxTokens: link.m,
            usedTokens: 0,
            expiresAt: Date(timeIntervalSince1970: link.e / 1000),
            relayUrl: link.r,
            createdAt: Date()
        )
        giftedCredentials.append(credential)
        saveGiftedCredentials()
    }

    func removeGiftedCredential(id: String) {
        if let gc = giftedCredentials.first(where: { $0.id == id }) {
            if giftPreferences[gc.providerId] == gc.giftId {
                giftPreferences.removeValue(forKey: gc.providerId)
                saveGiftPreferences()
            }
            // Unpin any group that was bound to this gift — avoids a dangling
            // reference that the routing resolver would silently fall through.
            var groupsChanged = false
            for idx in groups.indices where groups[idx].giftId == gc.giftId {
                groups[idx].giftId = nil
                groupsChanged = true
                let snapshot = groups[idx]
                Task { await syncGroupToVault(snapshot) }
            }
            if groupsChanged {
                try? saveGroups()
            }
        }
        giftedCredentials.removeAll { $0.id == id }
        saveGiftedCredentials()
    }

    func setGiftPreference(providerId: String, giftId: String?) {
        if let giftId {
            giftPreferences[providerId] = giftId
        } else {
            giftPreferences.removeValue(forKey: providerId)
        }
        saveGiftPreferences()
    }

    func updateGiftedCredentialUsage(giftId: String, usedTokens: Int) {
        if let idx = giftedCredentials.firstIndex(where: { $0.giftId == giftId }) {
            giftedCredentials[idx].usedTokens = usedTokens
            saveGiftedCredentials()
        }
    }

    /// Probe each non-expired received gift's relay to check whether the
    /// sender peer is online. Runs probes in parallel and fills in
    /// `giftPeerOnline` as each completes. Called from the Wallet screen on
    /// appear so the online dot reflects current state each time the user
    /// opens the tab.
    func probeGiftPeers() {
        let active = giftedCredentials.filter { !isGiftedCredentialExpired($0) && $0.usedTokens < $0.maxTokens }
        guard !active.isEmpty else {
            giftPeerOnline = [:]
            return
        }
        // Snapshot the set of active giftIds so we can prune stale entries
        // after probes complete.
        let activeIds = Set(active.map { $0.giftId })
        for gc in active {
            Task { [weak self] in
                let online = await probeGiftPeerOnline(giftedCredential: gc)
                await MainActor.run {
                    guard let self else { return }
                    // Drop probes for gifts that were removed while we waited.
                    guard activeIds.contains(gc.giftId) else { return }
                    self.giftPeerOnline[gc.giftId] = online
                }
            }
        }
    }

    private func loadGifts() {
        do {
            gifts = try keychain.loadCodable(key: giftsKey, as: [Gift].self)
        } catch {
            gifts = []
        }
    }

    private func saveGifts() {
        try? keychain.saveCodable(key: giftsKey, value: gifts)
    }

    private func loadGiftedCredentials() {
        do {
            giftedCredentials = try keychain.loadCodable(key: giftedCredentialsKey, as: [GiftedCredential].self)
        } catch {
            giftedCredentials = []
        }
    }

    private func saveGiftedCredentials() {
        try? keychain.saveCodable(key: giftedCredentialsKey, value: giftedCredentials)
    }

    private func loadGiftPreferences() {
        do {
            giftPreferences = try keychain.loadCodable(key: giftPreferencesKey, as: [String: String].self)
        } catch {
            giftPreferences = [:]
        }
    }

    private func saveGiftPreferences() {
        try? keychain.saveCodable(key: giftPreferencesKey, value: giftPreferences)
    }

    // MARK: - Cloud Vault

    private func loadCloudVaultState() {
        cloudVaultEnabled = (try? keychain.loadString(key: "cloudVault_enabled")) == "true"
        cloudVaultUsername = try? keychain.loadString(key: "cloudVault_username")
        cloudVaultLastUsername = try? keychain.loadString(key: "cloudVault_lastUsername")
        vaultToken = try? keychain.loadString(key: "cloudVault_token")
        vaultSessionId = try? keychain.loadString(key: "cloudVault_sessionId")
        cloudVaultTokenExpired = (try? keychain.loadString(key: "cloudVault_tokenExpired")) == "true"
        if let ts = try? keychain.loadString(key: "cloudVault_tokenIssuedAt"), let epoch = Double(ts) {
            vaultTokenIssuedAt = Date(timeIntervalSince1970: epoch)
        }
        if let mapJson = try? keychain.loadString(key: "cloudVault_credentialMap"),
           let data = mapJson.data(using: .utf8),
           let map = try? JSONDecoder().decode([String: String].self, from: data) {
            vaultCredentialMap = map
        } else {
            vaultCredentialMap = [:]
        }
        if let metaJson = try? keychain.loadString(key: "cloudVault_credentialMeta"),
           let data = metaJson.data(using: .utf8),
           let meta = try? JSONDecoder().decode([String: VaultCredentialMeta].self, from: data) {
            vaultCredentialMeta = meta
        } else {
            vaultCredentialMeta = [:]
        }
        if let ts = try? keychain.loadString(key: "cloudVault_lastSyncAt"), let v = Int64(ts) {
            vaultLastSyncAt = v
        } else {
            vaultLastSyncAt = 0
        }

        if cloudVaultEnabled, let issued = vaultTokenIssuedAt, Date().timeIntervalSince(issued) > 6 * 24 * 3600 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    private func saveCloudVaultConfig() {
        try? keychain.saveString(key: "cloudVault_enabled", value: cloudVaultEnabled ? "true" : "false")
        if let username = cloudVaultUsername { try? keychain.saveString(key: "cloudVault_username", value: username) }
        if let lastUsername = cloudVaultLastUsername { try? keychain.saveString(key: "cloudVault_lastUsername", value: lastUsername) }
        if let token = vaultToken { try? keychain.saveString(key: "cloudVault_token", value: token) }
        if let sid = vaultSessionId { try? keychain.saveString(key: "cloudVault_sessionId", value: sid) }
        if let issued = vaultTokenIssuedAt {
            try? keychain.saveString(key: "cloudVault_tokenIssuedAt", value: String(issued.timeIntervalSince1970))
        }
        try? keychain.saveString(key: "cloudVault_tokenExpired", value: cloudVaultTokenExpired ? "true" : "false")
        saveVaultCredentialMap()
    }

    private func saveVaultCredentialMap() {
        if let data = try? JSONEncoder().encode(vaultCredentialMap), let json = String(data: data, encoding: .utf8) {
            try? keychain.saveString(key: "cloudVault_credentialMap", value: json)
        }
    }

    private func saveVaultCredentialMeta() {
        if let data = try? JSONEncoder().encode(vaultCredentialMeta), let json = String(data: data, encoding: .utf8) {
            try? keychain.saveString(key: "cloudVault_credentialMeta", value: json)
        }
    }

    private func saveVaultLastSyncAt() {
        try? keychain.saveString(key: "cloudVault_lastSyncAt", value: String(vaultLastSyncAt))
    }

    private func persistVaultKey(password: String, encryptionSalt: String) {
        guard let saltBytes = Data(base64Encoded: encryptionSalt),
              let key = crypto.deriveKey(password: password, salt: saltBytes) else { return }
        vaultKey = key
        let rawBytes = key.withUnsafeBytes { Data($0) }
        try? keychain.save(key: "cloudVault_vaultKey", data: rawBytes)
    }

    private func loadVaultKey() -> SymmetricKey? {
        if let vaultKey { return vaultKey }
        guard let data = try? keychain.load(key: "cloudVault_vaultKey") else { return nil }
        let key = SymmetricKey(data: data)
        vaultKey = key
        return key
    }

    private func clearCloudVaultState(clearLastUsername: Bool = false) {
        cloudVaultEnabled = false
        cloudVaultUsername = nil
        cloudVaultTokenExpired = false
        vaultToken = nil
        vaultSessionId = nil
        vaultTokenIssuedAt = nil
        vaultCredentialMap = [:]
        vaultCredentialMeta = [:]
        vaultLastSyncAt = 0
        vaultKey = nil
        for key in ["cloudVault_enabled", "cloudVault_username", "cloudVault_token", "cloudVault_sessionId",
                     "cloudVault_tokenIssuedAt", "cloudVault_tokenExpired", "cloudVault_credentialMap",
                     "cloudVault_credentialMeta", "cloudVault_lastSyncAt", "cloudVault_vaultKey"] {
            try? keychain.delete(key: key)
        }
        if clearLastUsername {
            cloudVaultLastUsername = nil
            try? keychain.delete(key: "cloudVault_lastUsername")
        }
    }

    private func vaultRequest(path: String, method: String, body: [String: Any]? = nil, token: String? = nil) async -> (ok: Bool, status: Int, data: [String: Any]) {
        guard let url = URL(string: Self.vaultURL + path) else { return (false, 0, [:]) }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            return (200..<300 ~= status, status, json)
        } catch {
            return (false, 0, [:])
        }
    }

    func createVaultAppSession(appOrigin: String, providerIds: [String]) async -> (vaultUrl: String, appSessionToken: String, providers: [String: [String: Any]])? {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return nil }
        let providers = providerIds.map { ["id": $0] }
        let body: [String: Any] = ["appOrigin": appOrigin, "providers": providers]
        let result = await vaultRequest(path: "/connect", method: "POST", body: body, token: token)
        if result.status == 401 {
            await MainActor.run { cloudVaultTokenExpired = true }
            return nil
        }
        guard result.ok, let ast = result.data["appSessionToken"] as? String else { return nil }
        let providersMap = (result.data["providers"] as? [String: [String: Any]]) ?? [:]
        return (Self.vaultURL, ast, providersMap)
    }

    func checkUsernameAvailability(_ username: String) async -> (available: Bool, reason: String?) {
        let result = await vaultRequest(path: "/auth/check-username/\(username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username)", method: "GET")
        if !result.ok { return (false, nil) }
        let available = result.data["available"] as? Bool ?? false
        let reason = result.data["reason"] as? String
        return (available, reason)
    }

    func enableCloudVault(username: String, password: String, isSignup: Bool) async throws {
        let path = isSignup ? "/auth/signup" : "/auth/login"
        let result = await vaultRequest(path: path, method: "POST", body: ["username": username, "password": password])
        if !result.ok {
            let err = result.data["error"] as? [String: Any]
            throw CloudVaultError.authFailed(err?["message"] as? String ?? (isSignup ? "Signup failed" : "Login failed"))
        }
        guard let token = result.data["token"] as? String,
              let sessionId = result.data["sessionId"] as? String,
              let encryptionSalt = result.data["encryptionSalt"] as? String else {
            throw CloudVaultError.authFailed("Invalid server response")
        }

        persistVaultKey(password: password, encryptionSalt: encryptionSalt)
        vaultToken = token
        vaultSessionId = sessionId
        vaultTokenIssuedAt = Date()
        cloudVaultEnabled = true
        cloudVaultUsername = username
        cloudVaultLastUsername = username
        cloudVaultTokenExpired = false
        // Signup: fresh vault account, nothing to merge from — wipe meta
        // too so there's no stale tracking. Login: keep any existing meta/
        // map so we don't re-upload rows we already own; force a full pull
        // by resetting only lastSyncAt.
        if isSignup {
            vaultCredentialMap = [:]
            vaultCredentialMeta = [:]
        }
        vaultLastSyncAt = 0
        saveCloudVaultConfig()
        saveVaultCredentialMeta()
        saveVaultLastSyncAt()

        if !isSignup {
            await pullFromVault()
        }
        await syncAllCredentialsToVault()
        await syncPendingGroups()
        await syncPendingGifts()
    }

    func vaultBootstrapSignup(username: String, password: String) async throws {
        try createPassword(password)
        try await enableCloudVault(username: username, password: password, isSignup: true)
    }

    func vaultBootstrapLogin(username: String, password: String) async throws {
        // Validate vault credentials before creating any local wallet state.
        // Previously createPassword ran first, which meant a wrong password
        // silently initialized the local wallet with that password.
        try await enableCloudVault(username: username, password: password, isSignup: false)
        try createPassword(password)
    }

    var vaultBannerDismissedAt: Date? {
        get {
            let ts = UserDefaults.standard.double(forKey: "vaultBannerDismissedAt")
            return ts > 0 ? Date(timeIntervalSince1970: ts) : nil
        }
        set {
            if let d = newValue {
                UserDefaults.standard.set(d.timeIntervalSince1970, forKey: "vaultBannerDismissedAt")
            } else {
                UserDefaults.standard.removeObject(forKey: "vaultBannerDismissedAt")
            }
        }
    }

    func dismissVaultBanner() {
        vaultBannerDismissedAt = Date()
        objectWillChange.send()
    }

    func disableCloudVault() async {
        if let token = vaultToken, !cloudVaultTokenExpired {
            _ = await vaultRequest(path: "/auth/logout", method: "POST", token: token)
        }
        clearCloudVaultState()
    }

    func deleteVaultAccount() async throws {
        guard let token = vaultToken, !cloudVaultTokenExpired else {
            throw CloudVaultError.authFailed("No active vault session")
        }
        let result = await vaultRequest(path: "/auth/account", method: "DELETE", token: token)
        if !result.ok {
            let err = result.data["error"] as? [String: Any]
            throw CloudVaultError.authFailed(err?["message"] as? String ?? "Failed to delete vault account")
        }
        resetWallet()
    }

    func reloginCloudVault(password: String) async throws {
        guard let username = cloudVaultUsername else {
            throw CloudVaultError.authFailed("No vault account configured")
        }
        let result = await vaultRequest(path: "/auth/login", method: "POST", body: ["username": username, "password": password])
        if !result.ok {
            let err = result.data["error"] as? [String: Any]
            throw CloudVaultError.authFailed(err?["message"] as? String ?? "Login failed")
        }
        guard let token = result.data["token"] as? String,
              let sessionId = result.data["sessionId"] as? String,
              let encryptionSalt = result.data["encryptionSalt"] as? String else {
            throw CloudVaultError.authFailed("Invalid server response")
        }

        persistVaultKey(password: password, encryptionSalt: encryptionSalt)
        vaultToken = token
        vaultSessionId = sessionId
        vaultTokenIssuedAt = Date()
        cloudVaultTokenExpired = false
        saveCloudVaultConfig()

        await pullFromVault()
        await syncPendingCredentials()
        await syncPendingGroups()
        await syncPendingGifts()
        await reconcileGiftUsageWithVault()
    }

    private func syncAddToVault(localId: String, providerId: String, label: String, authMethod: String, plainKey: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        guard let vk = loadVaultKey(),
              let encryptedApiKey = try? crypto.encrypt(plaintext: plainKey, key: vk) else { return }

        let result = await vaultRequest(path: "/credentials", method: "POST", body: [
            "providerId": providerId, "encryptedApiKey": encryptedApiKey, "label": label, "authMethod": authMethod,
        ], token: token)

        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        if result.ok, let cred = result.data["credential"] as? [String: Any], let vaultId = cred["id"] as? String {
            vaultCredentialMap[localId] = vaultId
            saveVaultCredentialMap()
            let updatedAt = (cred["updatedAt"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000)
            vaultCredentialMeta[localId] = VaultCredentialMeta(serverId: vaultId, remoteUpdatedAt: updatedAt)
            saveVaultCredentialMeta()
        }
    }

    private func syncRemoveFromVault(localId: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        guard let vaultId = vaultCredentialMap[localId] else { return }

        let result = await vaultRequest(path: "/credentials/\(vaultId)", method: "DELETE", token: token)

        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        vaultCredentialMap.removeValue(forKey: localId)
        saveVaultCredentialMap()
        vaultCredentialMeta.removeValue(forKey: localId)
        saveVaultCredentialMeta()
    }

    private func syncRenameToVault(localId: String, newLabel: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        guard let vaultId = vaultCredentialMap[localId] else { return }

        let result = await vaultRequest(path: "/credentials/\(vaultId)", method: "PATCH", body: ["label": newLabel], token: token)

        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        if result.ok {
            let updatedAt = (result.data["updatedAt"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000)
            vaultCredentialMeta[localId] = VaultCredentialMeta(serverId: vaultId, remoteUpdatedAt: updatedAt)
            saveVaultCredentialMeta()
        }
    }

    private func syncPendingCredentials() async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        if let issued = vaultTokenIssuedAt, Date().timeIntervalSince(issued) > 6 * 24 * 3600 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        _ = token // suppress unused warning since used via syncAddToVault

        for credential in credentials {
            guard vaultCredentialMap[credential.id] == nil else { continue }
            guard let plainKey = try? decryptKey(for: credential) else { continue }
            await syncAddToVault(localId: credential.id, providerId: credential.providerId, label: credential.label, authMethod: credential.authMethod.rawValue, plainKey: plainKey)
        }
    }

    private func syncAllCredentialsToVault() async {
        for credential in credentials {
            // Skip rows already represented on the server (post-pull): the
            // extension does the same check to avoid creating duplicates.
            guard vaultCredentialMap[credential.id] == nil else { continue }
            guard let plainKey = try? decryptKey(for: credential) else { continue }
            await syncAddToVault(localId: credential.id, providerId: credential.providerId, label: credential.label, authMethod: credential.authMethod.rawValue, plainKey: plainKey)
        }
    }

    // MARK: - Vault pull + merge
    //
    // Mirrors the extension's pullFromVault: fetches /credentials/sync with
    // the stored lastSyncAt as `since`, applies tombstones, and upserts
    // non-tombstone rows with last-write-wins on updatedAt. New rows from
    // other devices land as fresh local credentials (re-encrypted under the
    // local master key).
    private func pullFromVault() async {
        guard let masterKey = masterKey else { return }
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }

        let result = await vaultRequest(path: "/credentials/sync?since=\(vaultLastSyncAt)", method: "GET", token: token)
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        guard result.ok else { return }

        let serverTime = (result.data["serverTime"] as? NSNumber)?.int64Value ?? Int64(Date().timeIntervalSince1970 * 1000)
        let remoteCreds = (result.data["credentials"] as? [[String: Any]]) ?? []

        if remoteCreds.isEmpty {
            vaultLastSyncAt = serverTime
            saveVaultLastSyncAt()
            return
        }

        // Backfill meta from legacy credentialMap so pre-sync installs get a
        // well-formed LWW baseline (remoteUpdatedAt=0 → first pull wins).
        for (localId, serverId) in vaultCredentialMap {
            if vaultCredentialMeta[localId] == nil {
                vaultCredentialMeta[localId] = VaultCredentialMeta(serverId: serverId, remoteUpdatedAt: 0)
            }
        }

        var serverToLocal: [String: String] = [:]
        for (localId, meta) in vaultCredentialMeta {
            serverToLocal[meta.serverId] = localId
        }

        var didMutate = false

        for remote in remoteCreds {
            guard let serverId = remote["id"] as? String,
                  let providerId = remote["providerId"] as? String,
                  let label = remote["label"] as? String,
                  let authMethodRaw = remote["authMethod"] as? String,
                  let updatedAt = (remote["updatedAt"] as? NSNumber)?.int64Value else { continue }
            let deletedAt = (remote["deletedAt"] as? NSNumber)?.int64Value

            let authMethod = AuthMethod(rawValue: authMethodRaw) ?? .apiKey
            let existingLocalId = serverToLocal[serverId]

            if deletedAt != nil {
                if let localId = existingLocalId {
                    try? keychain.delete(key: "key_\(localId)")
                    credentials.removeAll { $0.id == localId }
                    vaultCredentialMap.removeValue(forKey: localId)
                    vaultCredentialMeta.removeValue(forKey: localId)
                    didMutate = true
                }
                continue
            }

            guard let encryptedApiKey = remote["encryptedApiKey"] as? String,
                  let vk = loadVaultKey(),
                  let apiKey = try? crypto.decrypt(encoded: encryptedApiKey, key: vk) else { continue }

            if let localId = existingLocalId {
                let currentMeta = vaultCredentialMeta[localId]
                if let m = currentMeta, updatedAt <= m.remoteUpdatedAt { continue }
                if let idx = credentials.firstIndex(where: { $0.id == localId }) {
                    guard let encrypted = try? crypto.encrypt(plaintext: apiKey, key: masterKey) else { continue }
                    try? keychain.saveString(key: "key_\(localId)", value: "v2:" + encrypted)
                    let preserved = credentials[idx].createdAt
                    credentials[idx] = Credential(
                        id: localId,
                        providerId: providerId,
                        label: label,
                        authMethod: authMethod,
                        createdAt: preserved
                    )
                }
                vaultCredentialMeta[localId] = VaultCredentialMeta(serverId: serverId, remoteUpdatedAt: updatedAt)
                vaultCredentialMap[localId] = serverId
                didMutate = true
            } else {
                guard let encrypted = try? crypto.encrypt(plaintext: apiKey, key: masterKey) else { continue }
                let newId = UUID().uuidString
                try? keychain.saveString(key: "key_\(newId)", value: "v2:" + encrypted)
                let createdAtMs = (remote["createdAt"] as? NSNumber)?.int64Value
                let createdAt = createdAtMs.flatMap { Date(timeIntervalSince1970: TimeInterval($0) / 1000) } ?? Date()
                credentials.append(Credential(
                    id: newId,
                    providerId: providerId,
                    label: label,
                    authMethod: authMethod,
                    createdAt: createdAt
                ))
                vaultCredentialMap[newId] = serverId
                vaultCredentialMeta[newId] = VaultCredentialMeta(serverId: serverId, remoteUpdatedAt: updatedAt)
                didMutate = true
            }
        }

        vaultLastSyncAt = serverTime
        saveVaultLastSyncAt()

        if didMutate {
            try? saveCredentials()
            saveVaultCredentialMap()
            saveVaultCredentialMeta()
            AppGroupSync.shared.syncWalletState(
                isUnlocked: true,
                providers: credentials.map(\.providerId)
            )
        }
    }

    // MARK: - Vault group sync

    /// Push a single group to the cloud vault. Called on every createGroup /
    /// updateGroup so the offline vault's routing rules stay in lockstep with
    /// the phone's local state. No-op when cloud vault is disabled.
    ///
    /// The vault keys credential pins by its own credential ids (returned at
    /// sync time and stored in `vaultCredentialMap`). Translate the local
    /// pin id to the vault id before sending — a stale local pin maps to
    /// nil which the vault treats as "no pin".
    private func syncGroupToVault(_ group: Group) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        let vaultCredentialId: Any = group.credentialId.flatMap { vaultCredentialMap[$0] } ?? NSNull()
        let vaultGiftId: Any = group.giftId as Any? ?? NSNull()
        let result = await vaultRequest(
            path: "/groups/\(group.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? group.id)",
            method: "PUT",
            body: [
                "name": group.name,
                "providerId": group.providerId,
                "credentialId": vaultCredentialId,
                "giftId": vaultGiftId,
                "model": group.model as Any? ?? NSNull(),
            ],
            token: token
        )
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// Remove a group from the cloud vault. Called on deleteGroup.
    private func syncGroupDeleteToVault(groupId: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        let encoded = groupId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? groupId
        let result = await vaultRequest(path: "/groups/\(encoded)", method: "DELETE", token: token)
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// Push an app→group binding to the vault. Called on setAppGroup and on
    /// reassignment when a group is deleted.
    private func syncAppGroupToVault(origin: String, groupId: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        let encoded = origin.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? origin
        let result = await vaultRequest(
            path: "/groups/apps/\(encoded)",
            method: "PUT",
            body: ["groupId": groupId],
            token: token
        )
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// Backfill all local groups + app→group bindings to the vault. Runs on
    /// initial cloud-vault enable and on unlock when a vault session is
    /// already configured. Idempotent — the vault endpoints are upserts.
    ///
    /// Sequencing: MUST run after syncPendingCredentials so that any
    /// credential pins in local groups have a corresponding entry in
    /// vaultCredentialMap. Callers enforce this ordering.
    private func syncPendingGroups() async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        if let issued = vaultTokenIssuedAt, Date().timeIntervalSince(issued) > 6 * 24 * 3600 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        _ = token // used via the sync helpers below

        for group in groups {
            await syncGroupToVault(group)
        }
        for (origin, groupId) in appGroups {
            await syncAppGroupToVault(origin: origin, groupId: groupId)
        }
    }

    // MARK: - Vault gift relay

    /// Upload a gift to the cloud vault so it can act as a priority-0 fallback
    /// sender when this device is backgrounded / offline. Mirrors the browser
    /// extension's `registerGiftWithVault`.
    func registerGiftWithVault(_ gift: Gift) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        if let issued = vaultTokenIssuedAt, Date().timeIntervalSince(issued) > 6 * 24 * 3600 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        guard let credential = credentials.first(where: { $0.id == gift.credentialId }) else { return }
        guard let apiKey = try? decryptKey(for: credential) else { return }

        var body: [String: Any] = [
            "giftId": gift.id,
            "providerId": gift.providerId,
            "authMethod": credential.authMethod.rawValue,
            "apiKey": apiKey,
            "relayAuthToken": gift.authToken,
            "relayUrl": gift.relayUrl,
            "maxTokens": gift.maxTokens,
            "usedTokens": gift.usedTokens,
            "expiresAt": Int(gift.expiresAt.timeIntervalSince1970 * 1000),
        ]
        if let mgmtToken = gift.marketplaceManagementToken {
            body["marketplaceManagementToken"] = mgmtToken
        }
        let result = await vaultRequest(path: "/gifts", method: "POST", body: body, token: token)
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// Upload the marketplace management token to the vault so its heartbeat
    /// worker can keep the marketplace badge "online" on our behalf. Called
    /// after we successfully list a gift and receive the token.
    func uploadMarketplaceTokenToVault(giftId: String, token marketplaceToken: String) async {
        guard cloudVaultEnabled, let vaultBearer = vaultToken, !cloudVaultTokenExpired else { return }
        let result = await vaultRequest(
            path: "/gifts/\(giftId)/marketplace-token",
            method: "PATCH",
            body: ["marketplaceManagementToken": marketplaceToken],
            token: vaultBearer,
        )
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// Persist a marketplace management token on a local gift and upload a
    /// copy to the vault. Called by `CreateGiftView` right after the gift
    /// was listed publicly and the marketplace returned a mgmt token.
    func setGiftMarketplaceToken(giftId: String, token marketplaceToken: String) {
        guard let idx = gifts.firstIndex(where: { $0.id == giftId }) else { return }
        gifts[idx].marketplaceManagementToken = marketplaceToken
        saveGifts()
        Task { await uploadMarketplaceTokenToVault(giftId: giftId, token: marketplaceToken) }
    }

    func unregisterGiftFromVault(giftId: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        let result = await vaultRequest(path: "/gifts/\(giftId)", method: "DELETE", token: token)
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    /// If the vault serviced requests while this device was offline, its
    /// `usedTokens` may be ahead of ours. Pull and clamp-up the local copy.
    func syncGiftUsageFromVault(giftId: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        let result = await vaultRequest(path: "/gifts/\(giftId)", method: "GET", token: token)
        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        guard result.ok,
              let vaultGift = result.data["gift"] as? [String: Any],
              let vaultUsed = vaultGift["usedTokens"] as? Int else { return }
        guard let idx = gifts.firstIndex(where: { $0.id == giftId }) else { return }
        if vaultUsed > gifts[idx].usedTokens {
            gifts[idx].usedTokens = vaultUsed
            saveGifts()
        }
    }

    /// Backfill every active, non-expired gift to the vault. Runs on
    /// vault-enable and unlock. The vault's `POST /gifts` returns 409 for
    /// gifts it already has, which we tolerate.
    private func syncPendingGifts() async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }
        _ = token
        for gift in gifts where gift.active && Date() < gift.expiresAt {
            await registerGiftWithVault(gift)
        }
    }

    /// Reconcile `usedTokens` for every active gift against the vault. Called
    /// when the app returns to the foreground so the UI reflects usage the
    /// vault billed while we were backgrounded.
    func reconcileGiftUsageWithVault() async {
        guard cloudVaultEnabled, vaultToken != nil, !cloudVaultTokenExpired else { return }
        for gift in gifts where gift.active && Date() < gift.expiresAt {
            await syncGiftUsageFromVault(giftId: gift.id)
        }
    }

    // MARK: - Marketplace heartbeat
    //
    // Clients-side heartbeat that mirrors the vault's worker: while this app
    // is in the foreground, we POST /gifts/:id/heartbeat every 4 min so the
    // marketplace "online" badge stays green. The vault covers the phone-in-
    // pocket case.

    private static let marketplaceUrl = "https://marketplace.byoky.com"

    func heartbeatMarketplace() async {
        let now = Date()
        for gift in gifts where gift.active && now < gift.expiresAt {
            guard let mgmtToken = gift.marketplaceManagementToken else { continue }
            guard let url = URL(string: "\(Self.marketplaceUrl)/gifts/\(gift.id)/heartbeat") else { continue }
            var request = URLRequest(url: url, timeoutInterval: 10)
            request.httpMethod = "POST"
            request.setValue("Bearer \(mgmtToken)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: request)
        }
    }

    /// Best-effort: tell the marketplace the gift has been revoked so its
    /// public listing flips to "Removed" right away instead of waiting for
    /// the heartbeat to age out.
    func unlistMarketplaceGift(giftId: String, token mgmtToken: String) async {
        guard let url = URL(string: "\(Self.marketplaceUrl)/gifts/\(giftId)") else { return }
        var request = URLRequest(url: url, timeoutInterval: 10)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(mgmtToken)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }
}

enum WalletError: LocalizedError {
    case locked
    case wrongPassword
    case passwordHashFailed
    case credentialNotFound
    case lockedOut(Int)
    case invalidInput

    var errorDescription: String? {
        switch self {
        case .locked: return "Wallet is locked"
        case .wrongPassword: return "Wrong password"
        case .passwordHashFailed: return "Failed to hash password"
        case .credentialNotFound: return "Credential not found"
        case .lockedOut(let seconds): return "Too many attempts. Try again in \(seconds)s"
        case .invalidInput: return "Invalid input"
        }
    }
}

enum CloudVaultError: LocalizedError {
    case authFailed(String)

    var errorDescription: String? {
        switch self {
        case .authFailed(let message): return message
        }
    }
}
