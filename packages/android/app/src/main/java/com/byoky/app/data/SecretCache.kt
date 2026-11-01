package com.byoky.app.data

import java.util.concurrent.ConcurrentHashMap

/**
 * Decrypted keys of the unlocked wallet, keyed by their stored ciphertext.
 * Decrypting one is a 600k-iteration PBKDF2 (about a second on a phone), so
 * without this every proxied request paid it again; iOS likewise derives its
 * key once at unlock. A rewritten entry has a new ciphertext and misses on
 * its own. [WalletStore] clears it when the wallet locks or is reset. Pure,
 * unit-tested.
 */
class SecretCache {
    private val secrets = ConcurrentHashMap<String, String>()

    /** The plaintext of [ciphertext], decrypting it with [decrypt] only the first time. */
    fun get(ciphertext: String, decrypt: (String) -> String): String =
        secrets[ciphertext] ?: decrypt(ciphertext).also { secrets[ciphertext] = it }

    fun remove(ciphertext: String) {
        secrets.remove(ciphertext)
    }

    fun clear() = secrets.clear()

    val size: Int get() = secrets.size
}
