import Foundation
import Security

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case loadFailed
    case deleteFailed(OSStatus)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status): return "Keychain save failed: \(status)"
        case .loadFailed: return "Item not found in Keychain"
        case .deleteFailed(let status): return "Keychain delete failed: \(status)"
        case .encodingFailed: return "Data encoding failed"
        }
    }
}

final class KeychainService {
    static let shared = KeychainService()

    private let service = "com.byoky.app"
    private let accessGroup = "group.com.byoky.app"

    private init() {}

    // MARK: - Raw Data

    func save(key: String, data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    func load(key: String) throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.loadFailed
        }

        return data
    }

    func delete(key: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }

    // MARK: - Typed Helpers

    func saveString(key: String, value: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.encodingFailed
        }
        try save(key: key, data: data)
    }

    func loadString(key: String) throws -> String {
        let data = try load(key: key)
        guard let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.encodingFailed
        }
        return string
    }

    func saveCodable<T: Codable>(key: String, value: T) throws {
        let data = try JSONEncoder().encode(value)
        try save(key: key, data: data)
    }

    func loadCodable<T: Codable>(key: String, as type: T.Type) throws -> T {
        let data = try load(key: key)
        return try JSONDecoder().decode(type, from: data)
    }
}
