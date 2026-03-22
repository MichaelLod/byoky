import Combine
import Foundation

@MainActor
final class WalletStore: ObservableObject {
    static let shared = WalletStore()

    @Published var status: WalletStatus = .uninitialized
    @Published var credentials: [Credential] = []
    @Published var sessions: [Session] = []
    @Published var requestLogs: [RequestLog] = []
    @Published var bridgeStatus: BridgeStatus = .inactive

    private let keychain = KeychainService.shared
    private let crypto = CryptoService.shared
    private var masterPassword: String?

    private let passwordHashKey = "password_hash"
    private let credentialsKey = "credentials"
    private let sessionsKey = "sessions"

    private init() {
        checkInitialized()
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

    var isUnlocked: Bool {
        status == .unlocked
    }

    // MARK: - Password

    func createPassword(_ password: String) throws {
        guard let hash = crypto.hashPassword(password) else {
            throw WalletError.passwordHashFailed
        }

        try keychain.saveString(key: passwordHashKey, value: hash)
        masterPassword = password
        status = .unlocked
    }

    func unlock(password: String) throws {
        let hash = try keychain.loadString(key: passwordHashKey)

        guard crypto.verifyPassword(password, hash: hash) else {
            throw WalletError.wrongPassword
        }

        masterPassword = password
        status = .unlocked
        try loadCredentials()
        try loadSessions()
    }

    func lock() {
        masterPassword = nil
        credentials = []
        sessions = []
        status = .locked
    }

    // MARK: - Credentials

    func addCredential(providerId: String, label: String, apiKey: String) throws {
        guard let password = masterPassword else { throw WalletError.locked }

        let credential = Credential.create(providerId: providerId, label: label)
        let encryptedKey = try crypto.encrypt(plaintext: apiKey, password: password)

        try keychain.saveString(key: "key_\(credential.id)", value: encryptedKey)

        credentials.append(credential)
        try saveCredentials()
    }

    func removeCredential(_ credential: Credential) throws {
        try keychain.delete(key: "key_\(credential.id)")
        credentials.removeAll { $0.id == credential.id }
        try saveCredentials()
    }

    func decryptKey(for credential: Credential) throws -> String {
        guard let password = masterPassword else { throw WalletError.locked }
        let encrypted = try keychain.loadString(key: "key_\(credential.id)")
        return try crypto.decrypt(encoded: encrypted, password: password)
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

    var errorDescription: String? {
        switch self {
        case .locked: return "Wallet is locked"
        case .wrongPassword: return "Wrong password"
        case .passwordHashFailed: return "Failed to hash password"
        case .credentialNotFound: return "Credential not found"
        }
    }
}
