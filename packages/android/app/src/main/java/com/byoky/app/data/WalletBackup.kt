package com.byoky.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicInteger

/**
 * Export and import of `.byoky` backups for this wallet. Format and merge
 * rules live in [BackupFile]; this class wires them to [WalletStore].
 * Both operations are suspend functions that never block the caller's
 * thread: PBKDF2 runs on Dispatchers.Default and storage writes on
 * Dispatchers.IO.
 */
class WalletBackup(private val wallet: WalletStore) {

    /**
     * `total == 0` means indeterminate. [cancellable] turns false once an
     * import starts writing, so a cancel can't leave a partial import.
     */
    data class Progress(val message: String, val done: Int, val total: Int, val cancellable: Boolean = true)

    data class ImportSummary(val imported: Int, val duplicates: Int, val unsupported: Int) {
        val skipped: Int get() = duplicates + unsupported
    }

    /** Contents of a `.byoky` file holding every credential in the wallet. */
    suspend fun export(password: String, onProgress: (Progress) -> Unit = {}): String {
        val credentials = wallet.credentials.value
        if (credentials.isEmpty()) throw BackupFile.BackupException("There are no keys to export")
        val read = AtomicInteger(0)
        onProgress(Progress("Reading keys…", 0, credentials.size))
        val secrets = wallet.decryptSecrets(credentials) {
            onProgress(Progress("Reading keys…", read.incrementAndGet(), credentials.size))
        }
        val plain = credentials.mapIndexed { i, cred ->
            val secret = secrets[i] ?: throw BackupFile.BackupException("Could not read the key \"${cred.label}\"")
            BackupFile.PlainCredential(
                providerId = cred.providerId,
                label = cred.label,
                authMethod = cred.authMethod,
                createdAt = cred.createdAt,
                baseUrl = cred.baseUrl,
                secret = secret,
                id = cred.id,
            )
        }
        // One PBKDF2 per non-empty secret plus one for the envelope.
        val encryptTotal = plain.count { it.secret.isNotEmpty() } + 1
        val encrypted = AtomicInteger(0)
        onProgress(Progress("Encrypting backup…", 0, encryptTotal))
        return BackupFile.encode(plain, password) {
            onProgress(Progress("Encrypting backup…", encrypted.incrementAndGet(), encryptTotal))
        }
    }

    /**
     * Merge the credentials in a backup file into the wallet. Never deletes
     * or replaces existing keys; exact duplicates and credentials Android
     * can't use are skipped and counted. Throws [BackupFile.BackupException]
     * (for example [BackupFile.WRONG_PASSWORD]) without changing anything.
     */
    suspend fun import(contents: String, password: String, onProgress: (Progress) -> Unit = {}): ImportSummary {
        onProgress(Progress("Unlocking backup…", 0, 0))
        val entries = withContext(Dispatchers.Default) { BackupFile.decode(contents, password) }

        val now = System.currentTimeMillis()
        val usable = entries.mapNotNull { entry -> BackupFile.sanitize(entry, now)?.let { entry to it } }
        val unsupported = entries.size - usable.size
        if (usable.isEmpty()) return ImportSummary(0, 0, unsupported)

        val fileSecretCount = usable.count { !it.first.encryptedSecret.isNullOrEmpty() }
        val decrypted = AtomicInteger(0)
        onProgress(Progress("Decrypting keys…", 0, fileSecretCount))
        val secrets = BackupFile.decryptSecrets(usable.map { it.first }, password) {
            onProgress(Progress("Decrypting keys…", decrypted.incrementAndGet(), fileSecretCount))
        }
        val candidates = usable.mapIndexed { i, (entry, safe) ->
            BackupFile.PlainCredential(
                providerId = entry.providerId,
                label = entry.label,
                authMethod = safe.authMethod,
                createdAt = safe.createdAt,
                baseUrl = safe.baseUrl,
                secret = secrets[i],
            )
        }

        // Only stored keys of the same providers can be duplicates.
        val providers = candidates.mapTo(HashSet()) { it.providerId }
        val comparable = wallet.credentials.value.filter { it.providerId in providers }
        val checked = AtomicInteger(0)
        onProgress(Progress("Checking for duplicates…", 0, comparable.size))
        val existingSecrets = wallet.decryptSecrets(comparable) {
            onProgress(Progress("Checking for duplicates…", checked.incrementAndGet(), comparable.size))
        }
        val existing = comparable.mapIndexedNotNull { i, cred ->
            val secret = existingSecrets[i] ?: return@mapIndexedNotNull null
            BackupFile.PlainCredential(cred.providerId, cred.label, cred.authMethod, cred.createdAt, cred.baseUrl, secret, cred.id)
        }

        val plan = BackupFile.merge(candidates, existing)
        val toEncrypt = plan.toAdd.count { it.secret.isNotEmpty() }
        val saved = AtomicInteger(0)
        onProgress(Progress("Saving keys…", 0, toEncrypt, cancellable = false))
        wallet.addImportedCredentials(plan.toAdd) {
            onProgress(Progress("Saving keys…", saved.incrementAndGet(), toEncrypt, cancellable = false))
        }
        return ImportSummary(plan.toAdd.size, plan.duplicates, unsupported)
    }
}
