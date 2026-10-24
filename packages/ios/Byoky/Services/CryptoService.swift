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

    // MARK: - Key Derivation (PBKDF2-SHA256)

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

    func generateSalt() -> Data {
        randomBytes(count: saltLength)
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

        return constantTimeEqual(derivedData, storedKey)
    }

    // MARK: - AES-256-GCM with pre-derived SymmetricKey

    func encrypt(plaintext: String, key: SymmetricKey) throws -> String {
        guard let plaintextData = plaintext.data(using: .utf8) else {
            throw CryptoError.invalidData
        }

        let nonce = try AES.GCM.Nonce(data: randomBytes(count: nonceLength))
        let sealed = try AES.GCM.seal(plaintextData, using: key, nonce: nonce)

        var combined = Data()
        combined.append(Data(nonce))
        combined.append(sealed.ciphertext)
        combined.append(sealed.tag)

        return combined.base64EncodedString()
    }

    func decrypt(encoded: String, key: SymmetricKey) throws -> String {
        guard let combined = Data(base64Encoded: encoded) else {
            throw CryptoError.invalidData
        }

        let minLength = nonceLength + 16
        guard combined.count >= minLength else {
            throw CryptoError.invalidData
        }

        let nonceData = combined.prefix(nonceLength)
        let ciphertextAndTag = combined[nonceLength...]
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

    // MARK: - Password-based AES-256-GCM (@byoky/core format)
    //
    // Byte-compatible with `encrypt`/`decrypt` in packages/core/src/crypto.ts:
    // base64( salt[16] ‖ iv[12] ‖ ciphertext ‖ tag[16] ), key = PBKDF2-HMAC-
    // SHA256(UTF-8 password, salt, 600,000 iterations, 256 bits), UTF-8
    // plaintext. Used for `.byoky` backup files and the v1 key migration.
    // Every call runs a full PBKDF2, so keep these off the main thread.

    func encrypt(plaintext: String, password: String) throws -> String {
        let salt = randomBytes(count: saltLength)
        guard let key = deriveKey(password: password, salt: salt) else {
            throw CryptoError.keyDerivationFailed
        }
        let nonce = try AES.GCM.Nonce(data: randomBytes(count: nonceLength))
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: key, nonce: nonce)

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

        let minLength = saltLength + nonceLength + 16
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

        let decrypted: Data
        do {
            let nonce = try AES.GCM.Nonce(data: nonceData)
            let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            decrypted = try AES.GCM.open(sealedBox, using: key)
        } catch {
            throw CryptoError.decryptionFailed
        }

        guard let result = String(data: decrypted, encoding: .utf8) else {
            throw CryptoError.decryptionFailed
        }

        return result
    }

    /// v1 keys were stored in the core password-based format.
    func decryptLegacy(encoded: String, password: String) throws -> String {
        try decrypt(encoded: encoded, password: password)
    }

    // MARK: - Helpers

    private func constantTimeEqual(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        var result: UInt8 = 0
        for i in 0..<a.count {
            result |= a[a.startIndex + i] ^ b[b.startIndex + i]
        }
        return result == 0
    }

    private func randomBytes(count: Int) -> Data {
        var bytes = Data(count: count)
        bytes.withUnsafeMutableBytes { buffer in
            _ = SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        return bytes
    }
}
