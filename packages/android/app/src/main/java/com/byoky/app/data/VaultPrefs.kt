package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore

/**
 * Opens the encrypted store (`byoky_vault`, EncryptedSharedPreferences) and
 * recovers when it can't be read.
 *
 * Its keys are wrapped by an Android Keystore key that never leaves the
 * device. A vault file that arrives without that key (a device-to-device
 * transfer to a new phone, a restore by some vendors' tools) can never be
 * decrypted, and opening it threw on every launch, so the app crash-looped
 * until its data was cleared. Now such a vault is set aside as
 * `byoky_vault.unreadable.xml`, the app's plain state is cleared and the
 * wallet starts fresh, with a one-time notice to restore from a `.byoky`
 * backup. A fault that may be transient (the Keystore itself failing) is
 * retried once and otherwise rethrown: the vault is never wiped for it.
 */
object VaultPrefs {

    const val FILE = "byoky_vault"
    const val PLAIN_STATE_FILE = "byoky_state"

    /** Flag in [PLAIN_STATE_FILE]: the vault was unreadable and set aside. */
    const val RESET_NOTICE_FLAG = "unreadableVaultNoticePending"

    /** Where EncryptedSharedPreferences keeps its (wrapped) keysets, inside [FILE]. */
    private const val KEYSET_PREF = "__androidx_security_crypto_encrypted_prefs_key_keyset__"

    enum class Recovery {
        /** The vault can never be read here: set it aside and start fresh. */
        RESET,
        /** Possibly transient (Keystore unavailable): try again, never wipe. */
        RETRY,
        /** Not a vault problem: let it through. */
        FAIL,
    }

    /**
     * What to do about [error] thrown while opening the vault. A Keystore or
     * provider failure anywhere in the cause chain counts as transient, even
     * next to a definitive one. A failed decryption (wrong or missing key,
     * AEADBadTagException) or an unreadable keyset (IOException, including
     * protobuf's InvalidProtocolBufferException) is definitive.
     */
    fun recoveryFor(error: Throwable): Recovery {
        val chain = generateSequence(error) { it.cause }.take(16).toList()
        if (chain.any { isTransient(it) }) return Recovery.RETRY
        if (chain.any { it is GeneralSecurityException || it is IOException }) return Recovery.RESET
        return Recovery.FAIL
    }

    private fun isTransient(e: Throwable) =
        e is java.security.KeyStoreException ||
            e is java.security.ProviderException ||
            e.javaClass.name == "android.security.KeyStoreException"

    /**
     * Whether a vault must be set aside before it is even opened: it holds
     * a keyset, but the Keystore key that wraps it doesn't exist here.
     */
    fun mustReset(vaultHasKeyset: Boolean, masterKeyExists: Boolean): Boolean = vaultHasKeyset && !masterKeyExists

    /** The opened vault; [wasReset] when an unreadable one was set aside. */
    class Opened(val prefs: SharedPreferences, val wasReset: Boolean)

    fun open(context: Context): Opened {
        var wasReset = false
        val vaultHasKeyset = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).contains(KEYSET_PREF)
        if (mustReset(vaultHasKeyset, masterKeyExists())) {
            setAside(context)
            wasReset = true
        }
        var retried = false
        while (true) {
            try {
                return Opened(create(context), wasReset)
            } catch (e: Exception) {
                when (recoveryFor(e)) {
                    Recovery.RETRY -> {
                        if (retried) throw e
                        retried = true
                        Thread.sleep(RETRY_DELAY_MS)
                    }
                    Recovery.RESET -> {
                        if (wasReset) throw e
                        setAside(context)
                        wasReset = true
                    }
                    Recovery.FAIL -> throw e
                }
            }
        }
    }

    private fun create(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun masterKeyExists(): Boolean = try {
        androidKeyStore().containsAlias(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
    } catch (_: Exception) {
        // Can't tell: assume it does, so nothing is set aside on a guess.
        true
    }

    /**
     * Keep a copy of the unreadable vault, delete it and its Keystore key,
     * clear the plain state that belonged to it and raise the notice.
     */
    private fun setAside(context: Context) {
        val dir = File(context.applicationInfo.dataDir, "shared_prefs")
        val vault = File(dir, "$FILE.xml")
        if (vault.exists()) {
            try { vault.copyTo(File(dir, "$FILE.unreadable.xml"), overwrite = true) } catch (_: IOException) {}
        }
        context.deleteSharedPreferences(FILE)
        try { androidKeyStore().deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS) } catch (_: Exception) {}
        context.getSharedPreferences(PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit()
            .clear()
            .putBoolean(RESET_NOTICE_FLAG, true)
            .commit()
    }

    private fun androidKeyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private const val RETRY_DELAY_MS = 250L
}
