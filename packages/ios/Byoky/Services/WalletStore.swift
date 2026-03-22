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
    @Published var bridgeStatus: BridgeStatus = .inactive
    @Published var lockoutEndTime: Date?

    private let keychain = KeychainService.shared
    private let crypto = CryptoService.shared
    private var masterKey: SymmetricKey?

    private let passwordHashKey = "password_hash"
    private let masterSaltKey = "master_salt"
    private let credentialsKey = "credentials"
    private let sessionsKey = "sessions"

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
        status = .locked
        backgroundTime = nil
        AppGroupSync.shared.syncWalletState(isUnlocked: false, providers: [])
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
    }

    func removeCredential(_ credential: Credential) throws {
        try keychain.delete(key: "key_\(credential.id)")
        credentials.removeAll { $0.id == credential.id }
        try saveCredentials()

        AppGroupSync.shared.syncWalletState(
            isUnlocked: true,
            providers: credentials.map(\.providerId)
        )
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
