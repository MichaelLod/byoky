import CommonCrypto
import CryptoKit
import Foundation

enum CryptoError: LocalizedError {
    case invalidData
    case decryptionFailed
    case keyDerivationFailed

    var errorDescription: String? {
        switch self {
        case .invalidData: return "Invalid encrypted data"
        case .decryptionFailed: return "Decryption failed — wrong password?"
        case .keyDerivationFailed: return "Key derivation failed"
        }
    }
}

final class CryptoService {
    static let shared = CryptoService()

    private let iterations = 600_000
    private let saltLength = 16
    private let nonceLength = 12

    private init() {}

    // MARK: - Key Derivation (PBKDF2-SHA256, matches Web Crypto implementation)

    func deriveKey(password: String, salt: Data) -> SymmetricKey? {
        guard let passwordData = password.data(using: .utf8) else { return nil }

        var derivedKey = Data(count: 32)
        let result = derivedKey.withUnsafeMutableBytes { derivedKeyBytes in
            salt.withUnsafeBytes { saltBytes in
                passwordData.withUnsafeBytes { passwordBytes in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBytes.baseAddress?.assumingMemoryBound(to: Int8.self),
                        passwordData.count,
                        saltBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        UInt32(iterations),
                        derivedKeyBytes.baseAddress?.assumingMemoryBound(to: UInt8.self),
                        32
                    )
                }
            }
        }

        guard result == kCCSuccess else { return nil }
        return SymmetricKey(data: derivedKey)
    }

    // MARK: - Password Hash (for verifying unlock)

    func hashPassword(_ password: String) -> String? {
        let salt = randomBytes(count: saltLength)
        guard let key = deriveKey(password: password, salt: salt) else { return nil }
        let keyData = key.withUnsafeBytes { Data($0) }
        var combined = Data()
        combined.append(salt)
        combined.append(keyData)
        return combined.base64EncodedString()
    }

    func verifyPassword(_ password: String, hash: String) -> Bool {
        guard let combined = Data(base64Encoded: hash),
              combined.count == saltLength + 32 else { return false }

        let salt = combined.prefix(saltLength)
        let storedKey = combined.suffix(32)

        guard let derivedKey = deriveKey(password: password, salt: salt) else { return false }
        let derivedData = derivedKey.withUnsafeBytes { Data($0) }

        return derivedData == storedKey
    }

    // MARK: - AES-256-GCM Encrypt/Decrypt (compatible with Web Crypto format)

    func encrypt(plaintext: String, password: String) throws -> String {
        guard let plaintextData = plaintext.data(using: .utf8) else {
            throw CryptoError.invalidData
        }

        let salt = randomBytes(count: saltLength)
        guard let key = deriveKey(password: password, salt: salt) else {
            throw CryptoError.keyDerivationFailed
        }

        let nonce = try AES.GCM.Nonce(data: randomBytes(count: nonceLength))
        let sealed = try AES.GCM.seal(plaintextData, using: key, nonce: nonce)

        // Format: salt || nonce || ciphertext+tag (matches web crypto format)
        var combined = Data()
        combined.append(salt)
        combined.append(Data(nonce))
        combined.append(sealed.ciphertext)
        combined.append(sealed.tag)

        return combined.base64EncodedString()
    }

    func decrypt(encoded: String, password: String) throws -> String {
        guard let combined = Data(base64Encoded: encoded) else {
            throw CryptoError.invalidData
        }

        let minLength = saltLength + nonceLength + 16 // 16 = GCM tag
        guard combined.count >= minLength else {
            throw CryptoError.invalidData
        }

        let salt = combined.prefix(saltLength)
        let nonceData = combined[saltLength..<(saltLength + nonceLength)]
        let ciphertextAndTag = combined[(saltLength + nonceLength)...]

        guard let key = deriveKey(password: password, salt: salt) else {
            throw CryptoError.keyDerivationFailed
        }

        let tagStart = ciphertextAndTag.count - 16
        let ciphertext = ciphertextAndTag.prefix(tagStart)
        let tag = ciphertextAndTag.suffix(16)

        let nonce = try AES.GCM.Nonce(data: nonceData)
        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let decrypted = try AES.GCM.open(sealedBox, using: key)

        guard let result = String(data: decrypted, encoding: .utf8) else {
            throw CryptoError.decryptionFailed
        }

        return result
    }

    // MARK: - Helpers

    private func randomBytes(count: Int) -> Data {
        var bytes = Data(count: count)
        bytes.withUnsafeMutableBytes { buffer in
            _ = SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        return bytes
    }
}
