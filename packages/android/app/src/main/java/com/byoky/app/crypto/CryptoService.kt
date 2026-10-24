package com.byoky.app.crypto

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import java.util.Base64

/**
 * AES-256-GCM encryption with PBKDF2 key derivation.
 *
 * Byte-compatible with `encrypt` / `decrypt` in packages/core/src/crypto.ts
 * (and therefore with `.byoky` backup files written by the extension):
 * base64( salt[16] ‖ iv[12] ‖ ciphertext+tag[16] ), key = PBKDF2-HMAC-SHA256
 * over the UTF-8 password, 600,000 iterations, 256 bits; plaintext UTF-8.
 *
 * Pure JVM (java.util.Base64, no android.* imports) so the format can be
 * verified in local unit tests. Base64 is the standard alphabet with padding
 * and no line breaks, the same bytes android.util.Base64.NO_WRAP produced
 * for data already stored on devices.
 */
object CryptoService {
    private const val ITERATIONS = 600_000
    private const val SALT_LENGTH = 16
    private const val NONCE_LENGTH = 12
    private const val KEY_LENGTH = 256
    private const val TAG_LENGTH = 128

    private val random = SecureRandom()

    // MARK: - Key Derivation (PBKDF2-SHA256)

    private fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_LENGTH)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val keyBytes = factory.generateSecret(spec).encoded
        return SecretKeySpec(keyBytes, "AES")
    }

    // MARK: - Password Hash

    fun hashPassword(password: String): String {
        val salt = randomBytes(SALT_LENGTH)
        val key = deriveKey(password, salt)
        val combined = salt + key.encoded
        return Base64.getEncoder().encodeToString(combined)
    }

    fun verifyPassword(password: String, hash: String): Boolean {
        val combined = Base64.getDecoder().decode(hash)
        if (combined.size != SALT_LENGTH + 32) return false

        val salt = combined.copyOfRange(0, SALT_LENGTH)
        val storedKey = combined.copyOfRange(SALT_LENGTH, combined.size)
        val derivedKey = deriveKey(password, salt)

        return derivedKey.encoded.contentEquals(storedKey)
    }

    // MARK: - AES-256-GCM Encrypt/Decrypt (Web Crypto compatible format)

    fun encrypt(plaintext: String, password: String): String {
        val salt = randomBytes(SALT_LENGTH)
        val nonce = randomBytes(NONCE_LENGTH)
        val key = deriveKey(password, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH, nonce))

        val ciphertextWithTag = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        // Format: salt || nonce || ciphertext+tag (matches web crypto)
        val combined = salt + nonce + ciphertextWithTag
        return Base64.getEncoder().encodeToString(combined)
    }

    fun decrypt(encoded: String, password: String): String {
        val combined = Base64.getDecoder().decode(encoded)
        val minLength = SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH / 8
        require(combined.size >= minLength) { "Invalid encrypted data" }

        val salt = combined.copyOfRange(0, SALT_LENGTH)
        val nonce = combined.copyOfRange(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH)
        val ciphertextWithTag = combined.copyOfRange(SALT_LENGTH + NONCE_LENGTH, combined.size)

        val key = deriveKey(password, salt)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_LENGTH, nonce))

        val plaintext = cipher.doFinal(ciphertextWithTag)
        return String(plaintext, Charsets.UTF_8)
    }

    private fun randomBytes(count: Int): ByteArray {
        val bytes = ByteArray(count)
        random.nextBytes(bytes)
        return bytes
    }
}
