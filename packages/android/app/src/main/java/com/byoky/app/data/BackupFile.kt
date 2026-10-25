package com.byoky.app.data

import com.byoky.app.crypto.CryptoService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * The `.byoky` backup file: the server-free way to move keys between the
 * browser extension, iOS and Android. Same format as
 * packages/extension/lib/vault-file.ts:
 *
 *   file    = encrypt(JSON.stringify(payload), exportPassword)
 *   payload = { version: 2, exportedAt: <ms>, credentials: [ … ] }
 *   credential = { id, providerId, label, authMethod: "api_key" | "oauth",
 *                  createdAt, baseUrl?, encryptedKey? (api_key),
 *                  encryptedAccessToken? (oauth), encryptedRefreshToken?,
 *                  expiresAt?, …unknown fields ignored }
 *
 * `encrypt` is [CryptoService.encrypt] (byte-compatible with core's). Every
 * `encrypted*` field is the plaintext secret encrypted on its own under the
 * export password; keyless local providers carry `encryptedKey: ""`. Older
 * files may also contain `gifts` / `giftedCredentials`; they are ignored.
 *
 * Each secret costs one 600k-iteration PBKDF2, so the bulk operations run in
 * parallel on [Dispatchers.Default]. Nothing here touches the main thread or
 * Android APIs, which keeps it unit-testable on the JVM.
 */
object BackupFile {
    const val VERSION = 2

    /** Largest file accepted for import, in bytes. */
    const val MAX_FILE_BYTES = 10 * 1024 * 1024

    /** Decrypted payload cap, matching the extension's MAX_VAULT_FILE_JSON_LENGTH. */
    private const val MAX_JSON_LENGTH = 10_485_760

    /** Most credentials a file may carry. */
    const val MAX_ENTRIES = 500

    /**
     * Deepest JSON nesting accepted. A real backup nests 3 levels; org.json
     * parses recursively, so a hostile file with thousands of levels would
     * otherwise overflow the stack.
     */
    private const val MAX_JSON_DEPTH = 32

    private const val MAX_LABEL_LENGTH = 200

    const val WRONG_PASSWORD = "Wrong password or corrupted file"
    const val INVALID_FORMAT = "Invalid backup file format"

    class BackupException(message: String) : Exception(message)

    /** A credential with its plaintext secret ("" for keyless local providers). */
    data class PlainCredential(
        val providerId: String,
        val label: String,
        val authMethod: AuthMethod,
        val createdAt: Long,
        val baseUrl: String?,
        val secret: String,
        val id: String = UUID.randomUUID().toString(),
    )

    /** One credential as found in a backup file, secret still encrypted. */
    data class FileEntry(
        val providerId: String,
        val label: String,
        /** "api_key" or "oauth". */
        val authMethod: String,
        val createdAt: Long,
        val baseUrl: String?,
        /** `encryptedKey` or `encryptedAccessToken`; null/empty means no secret. */
        val encryptedSecret: String?,
        val hasRefreshToken: Boolean,
        val expiresAt: Long?,
    )

    // ── Export ───────────────────────────────────────────────────────────

    /**
     * Build the contents of a `.byoky` file. [onStep] fires once per PBKDF2
     * (one per non-empty secret, plus one for the envelope), from worker
     * threads.
     */
    suspend fun encode(
        credentials: List<PlainCredential>,
        password: String,
        exportedAt: Long = System.currentTimeMillis(),
        onStep: () -> Unit = {},
    ): String {
        val encryptedSecrets = parallelMap(credentials) { cred ->
            if (cred.secret.isEmpty()) "" else CryptoService.encrypt(cred.secret, password).also { onStep() }
        }
        val array = JSONArray()
        credentials.forEachIndexed { i, cred ->
            val obj = JSONObject()
                .put("id", cred.id)
                .put("providerId", cred.providerId)
                .put("label", cred.label)
                .put("authMethod", authMethodName(cred.authMethod))
                .put("createdAt", cred.createdAt)
            // Only providers without a fixed host have a meaningful base URL.
            if (CredentialBaseUrl.isRequired(cred.providerId)) {
                cred.baseUrl?.takeIf { it.isNotEmpty() }?.let { obj.put("baseUrl", CredentialBaseUrl.normalize(cred.providerId, it) ?: it) }
            }
            obj.put(if (cred.authMethod == AuthMethod.OAUTH) "encryptedAccessToken" else "encryptedKey", encryptedSecrets[i])
            array.put(obj)
        }
        val payload = JSONObject()
            .put("version", VERSION)
            .put("exportedAt", exportedAt)
            .put("credentials", array)
        // The envelope's PBKDF2 must not run on the caller's (possibly main) thread.
        return withContext(Dispatchers.Default) {
            CryptoService.encrypt(payload.toString(), password).also { onStep() }
        }
    }

    // ── Import ───────────────────────────────────────────────────────────

    /**
     * Decrypt the envelope and parse its credential list (one PBKDF2).
     * Throws [BackupException] with [WRONG_PASSWORD] when decryption fails
     * and [INVALID_FORMAT] when the payload isn't a backup. Like the
     * extension, a malformed credential entry rejects the whole file.
     */
    fun decode(contents: String, password: String): List<FileEntry> {
        // atob() in the extension tolerates whitespace and line wrapping.
        val compact = contents.removePrefix("\uFEFF").filterNot { it.isWhitespace() }
        if (compact.isEmpty()) throw BackupException(INVALID_FORMAT)
        val json = try {
            CryptoService.decrypt(compact, password)
        } catch (_: Exception) {
            throw BackupException(WRONG_PASSWORD)
        }
        if (json.length > MAX_JSON_LENGTH) throw BackupException("Backup file too large")
        if (nestingExceeds(json, MAX_JSON_DEPTH)) throw BackupException(INVALID_FORMAT)

        val payload = try {
            JSONObject(json)
        } catch (_: Throwable) {
            // Throwable on purpose: also catches StackOverflowError should the
            // depth pre-check ever be bypassed.
            throw BackupException(INVALID_FORMAT)
        }
        val version = payload.opt("version") as? Number
        val credentials = payload.opt("credentials") as? JSONArray
        if (version == null || version.toDouble() < 1 || credentials == null) {
            throw BackupException(INVALID_FORMAT)
        }
        if (credentials.length() > MAX_ENTRIES) {
            throw BackupException("This file has more than $MAX_ENTRIES keys, which no Byoky backup does.")
        }
        return (0 until credentials.length()).map { i ->
            parseEntry(credentials.opt(i)) ?: throw BackupException(INVALID_FORMAT)
        }
    }

    private fun parseEntry(raw: Any?): FileEntry? {
        val c = raw as? JSONObject ?: return null
        val providerId = (c.opt("providerId") as? String)?.takeIf { it.isNotEmpty() } ?: return null
        val authMethod = c.opt("authMethod") as? String
        if (authMethod != "api_key" && authMethod != "oauth") return null
        val secret = if (authMethod == "oauth") {
            (c.opt("encryptedAccessToken") as? String)?.takeIf { it.isNotEmpty() } ?: return null
        } else {
            when (val key = c.opt("encryptedKey")) {
                null -> null
                is String -> key
                else -> return null
            }
        }
        return FileEntry(
            providerId = providerId,
            // Same as the extension: trim, cut to 200, fall back to the provider's name.
            label = (c.opt("label") as? String)?.trim()?.take(MAX_LABEL_LENGTH)?.takeIf { it.isNotEmpty() }
                ?: Provider.find(providerId)?.name ?: providerId,
            authMethod = authMethod,
            // Missing or non-positive → 0, which sanitize() turns into "now".
            createdAt = (c.opt("createdAt") as? Number)?.toDouble()?.takeIf { it.isFinite() && it > 0 }?.toLong() ?: 0L,
            baseUrl = (c.opt("baseUrl") as? String)?.takeIf { it.isNotEmpty() },
            encryptedSecret = secret,
            hasRefreshToken = (c.opt("encryptedRefreshToken") as? String)?.isNotEmpty() == true,
            expiresAt = (c.opt("expiresAt") as? Number)?.toLong(),
        )
    }

    /** What Android stores for an imported entry, after sanitizing it. */
    data class Importable(
        val authMethod: AuthMethod,
        /** Only for providers without a fixed host, and only if safe (see [CredentialBaseUrl]). */
        val baseUrl: String?,
        /** Never in the future: routing prefers the newest credential. */
        val createdAt: Long,
    )

    /**
     * Whether and how Android can import [entry]; null means skip it:
     *  - unknown or retired providers;
     *  - OAuth credentials other than Anthropic setup tokens (refreshable
     *    logins expire and Android has no refresh flow);
     *  - providers without a fixed host whose base URL is missing or unsafe
     *    (not https, or http to anything but localhost/127.0.0.1 for local
     *    servers).
     * A base URL on a fixed-host provider is dropped, never stored.
     */
    fun sanitize(entry: FileEntry, now: Long = System.currentTimeMillis()): Importable? {
        val provider = Provider.find(entry.providerId) ?: return null
        val method = when (entry.authMethod) {
            "api_key" -> AuthMethod.API_KEY
            "oauth" -> {
                val usable = entry.providerId == "anthropic" &&
                    !entry.hasRefreshToken &&
                    (entry.expiresAt == null || entry.expiresAt > now)
                if (usable) AuthMethod.OAUTH else return null
            }
            else -> return null
        }
        val baseUrl = if (provider.requiresCustomBaseUrl) {
            CredentialBaseUrl.normalize(provider.id, entry.baseUrl) ?: return null
        } else null
        val createdAt = if (entry.createdAt <= 0) now else minOf(entry.createdAt, now)
        return Importable(method, baseUrl, createdAt)
    }

    /**
     * Decrypt the secrets of [entries] under the file's password, in
     * parallel. All-or-nothing: any failure throws, so nothing gets stored.
     */
    suspend fun decryptSecrets(
        entries: List<FileEntry>,
        password: String,
        onStep: () -> Unit = {},
    ): List<String> = parallelMap(entries) { entry ->
        val encrypted = entry.encryptedSecret
        if (encrypted.isNullOrEmpty()) {
            ""
        } else {
            try {
                CryptoService.decrypt(encrypted, password).also { onStep() }
            } catch (_: Exception) {
                throw BackupException("Could not decrypt a key in the file")
            }
        }
    }

    data class MergePlan(val toAdd: List<PlainCredential>, val duplicates: Int)

    /**
     * Decide which [candidates] to add to a wallet that already holds
     * [existing]. Existing keys are never replaced. A candidate is a
     * duplicate when a credential with the same provider, the same secret
     * and the same base URL is already present (in the wallet or earlier in
     * the file), the extension's rule. Added credentials get fresh ids.
     */
    fun merge(candidates: List<PlainCredential>, existing: List<PlainCredential>): MergePlan {
        val seen = existing.mapTo(HashSet()) { duplicateKey(it) }
        val toAdd = mutableListOf<PlainCredential>()
        var duplicates = 0
        for (cred in candidates) {
            if (!seen.add(duplicateKey(cred))) {
                duplicates++
                continue
            }
            toAdd.add(cred.copy(id = UUID.randomUUID().toString()))
        }
        return MergePlan(toAdd, duplicates)
    }

    private fun duplicateKey(c: PlainCredential): List<String> = listOf(c.providerId, c.secret, c.baseUrl ?: "")

    fun authMethodName(method: AuthMethod): String = if (method == AuthMethod.OAUTH) "oauth" else "api_key"

    /** Runs [block] for every item concurrently on [Dispatchers.Default], preserving order. */
    /** Each item checks for cancellation before its (PBKDF2-heavy) work starts. */
    private suspend fun <T, R> parallelMap(items: List<T>, block: suspend (T) -> R): List<R> = coroutineScope {
        items.map { async(Dispatchers.Default) { ensureActive(); block(it) } }.awaitAll()
    }

    /**
     * True when [json] nests objects/arrays deeper than [limit]. Linear scan
     * that skips string contents, so it is safe on hostile input.
     */
    internal fun nestingExceeds(json: String, limit: Int): Boolean {
        var depth = 0
        var inString = false
        var escaped = false
        for (ch in json) {
            if (inString) {
                when {
                    escaped -> escaped = false
                    ch == '\\' -> escaped = true
                    ch == '"' -> inString = false
                }
                continue
            }
            when (ch) {
                '"' -> inString = true
                '{', '[' -> if (++depth > limit) return true
                '}', ']' -> depth--
            }
        }
        return false
    }
}
