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
    @Published var giftPreferences: [String: String] = [:]  // providerId -> giftId
    @Published var tokenAllowances: [TokenAllowance] = []
    @Published var bridgeStatus: BridgeStatus = .inactive
    @Published var lockoutEndTime: Date?
    @Published var cloudVaultEnabled = false
    @Published var cloudVaultUsername: String?
    @Published var cloudVaultTokenExpired = false

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

    private static let vaultURL = "https://vault.byoky.com"
    private var vaultToken: String?
    private var vaultSessionId: String?
    private var vaultTokenIssuedAt: Date?
    private var vaultCredentialMap: [String: String] = [:]

    private let autoLockTimeout: TimeInterval = 300
    private var backgroundTime: Date?

    private var failedAttempts: Int {
        get { UserDefaults.standard.integer(forKey: "byoky_failedUnlockAttempts") }
        set { UserDefaults.standard.set(newValue, forKey: "byoky_failedUnlockAttempts") }
    }

    private init() {
        checkInitialized()
        restoreLockoutState()
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
        try loadSessions()
        loadRequestLogs()
        loadGifts()
        loadGiftedCredentials()
        loadGiftPreferences()
        loadTokenAllowances()
        try migrateCredentials(password: password)
        loadCloudVaultState()
        Task { await syncPendingCredentials() }

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
        gifts = []
        giftedCredentials = []
        giftPreferences = [:]
        tokenAllowances = []
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
        clearCloudVaultState()

        // Clear in-memory state
        credentials = []
        sessions = []
        requestLogs = []
        gifts = []
        giftedCredentials = []
        tokenAllowances = []
        bridgeStatus = .inactive

        // Reset brute-force state
        failedAttempts = 0
        lockoutEndTime = nil
        UserDefaults.standard.set(0.0, forKey: "byoky_lockoutEndTime")

        AppGroupSync.shared.syncWalletState(isUnlocked: false, providers: [])
        status = .uninitialized
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
        responseBody: String?
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
            let usage = UsageParser.parseUsage(providerId: providerId, body: responseBody)
            entry.inputTokens = usage?.inputTokens
            entry.outputTokens = usage?.outputTokens
        }

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
        return gift
    }

    func revokeGift(id: String) {
        guard let index = gifts.firstIndex(where: { $0.id == id }) else { return }
        gifts[index].active = false
        saveGifts()
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

        if cloudVaultEnabled, let issued = vaultTokenIssuedAt, Date().timeIntervalSince(issued) > 6 * 24 * 3600 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
        }
    }

    private func saveCloudVaultConfig() {
        try? keychain.saveString(key: "cloudVault_enabled", value: cloudVaultEnabled ? "true" : "false")
        if let username = cloudVaultUsername { try? keychain.saveString(key: "cloudVault_username", value: username) }
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

    private func clearCloudVaultState() {
        cloudVaultEnabled = false
        cloudVaultUsername = nil
        cloudVaultTokenExpired = false
        vaultToken = nil
        vaultSessionId = nil
        vaultTokenIssuedAt = nil
        vaultCredentialMap = [:]
        for key in ["cloudVault_enabled", "cloudVault_username", "cloudVault_token", "cloudVault_sessionId",
                     "cloudVault_tokenIssuedAt", "cloudVault_tokenExpired", "cloudVault_credentialMap"] {
            try? keychain.delete(key: key)
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
              let sessionId = result.data["sessionId"] as? String else {
            throw CloudVaultError.authFailed("Invalid server response")
        }

        vaultToken = token
        vaultSessionId = sessionId
        vaultTokenIssuedAt = Date()
        cloudVaultEnabled = true
        cloudVaultUsername = username
        cloudVaultTokenExpired = false
        vaultCredentialMap = [:]
        saveCloudVaultConfig()

        await syncAllCredentialsToVault()
    }

    func disableCloudVault() async {
        if let token = vaultToken, !cloudVaultTokenExpired {
            _ = await vaultRequest(path: "/auth/logout", method: "POST", token: token)
        }
        clearCloudVaultState()
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
              let sessionId = result.data["sessionId"] as? String else {
            throw CloudVaultError.authFailed("Invalid server response")
        }

        vaultToken = token
        vaultSessionId = sessionId
        vaultTokenIssuedAt = Date()
        cloudVaultTokenExpired = false
        saveCloudVaultConfig()

        await syncPendingCredentials()
    }

    private func syncAddToVault(localId: String, providerId: String, label: String, authMethod: String, plainKey: String) async {
        guard cloudVaultEnabled, let token = vaultToken, !cloudVaultTokenExpired else { return }

        let result = await vaultRequest(path: "/credentials", method: "POST", body: [
            "providerId": providerId, "apiKey": plainKey, "label": label, "authMethod": authMethod,
        ], token: token)

        if result.status == 401 {
            cloudVaultTokenExpired = true
            try? keychain.saveString(key: "cloudVault_tokenExpired", value: "true")
            return
        }
        if result.ok, let cred = result.data["credential"] as? [String: Any], let vaultId = cred["id"] as? String {
            vaultCredentialMap[localId] = vaultId
            saveVaultCredentialMap()
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
            guard let plainKey = try? decryptKey(for: credential) else { continue }
            await syncAddToVault(localId: credential.id, providerId: credential.providerId, label: credential.label, authMethod: credential.authMethod.rawValue, plainKey: plainKey)
        }
    }
}

enum WalletError: LocalizedError {
    case locked
    case wrongPassword
    case passwordHashFailed
    case credentialNotFound
    case lockedOut(Int)

    var errorDescription: String? {
        switch self {
        case .locked: return "Wallet is locked"
        case .wrongPassword: return "Wrong password"
        case .passwordHashFailed: return "Failed to hash password"
        case .credentialNotFound: return "Credential not found"
        case .lockedOut(let seconds): return "Too many attempts. Try again in \(seconds)s"
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
