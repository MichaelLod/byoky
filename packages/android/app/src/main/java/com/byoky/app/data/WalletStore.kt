package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.byoky.app.crypto.CryptoService
import com.byoky.app.proxy.TranslationEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

enum class WalletStatus { UNINITIALIZED, LOCKED, UNLOCKED }

sealed class UnlockResult {
    data object Success : UnlockResult()
    data object WrongPassword : UnlockResult()
    data class LockedOut(val secondsRemaining: Int) : UnlockResult()
}

class WalletStore(context: Context) {
    /** App context, retained for lazy access to TranslationEngine when logging
     *  requests (capability fingerprint detection runs through the JS bridge). */
    private val appContext: Context = context.applicationContext

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    // Encrypted local store for the password hash, encrypted keys, groups,
    // sessions and logs. The file name predates the local-only design and
    // must stay as is: renaming it would orphan every existing wallet.
    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        ENCRYPTED_PREFS_FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val plainPrefs: SharedPreferences =
        context.getSharedPreferences("byoky_state", Context.MODE_PRIVATE)

    private val _status = MutableStateFlow(WalletStatus.UNINITIALIZED)
    val status: StateFlow<WalletStatus> = _status.asStateFlow()

    private val _credentials = MutableStateFlow<List<Credential>>(emptyList())
    val credentials: StateFlow<List<Credential>> = _credentials.asStateFlow()

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _requestLogs = MutableStateFlow<List<RequestLog>>(emptyList())
    val requestLogs: StateFlow<List<RequestLog>> = _requestLogs.asStateFlow()

    private val _tokenAllowances = MutableStateFlow<List<TokenAllowance>>(emptyList())
    val tokenAllowances: StateFlow<List<TokenAllowance>> = _tokenAllowances.asStateFlow()

    private val _groups = MutableStateFlow<List<Group>>(emptyList())
    val groups: StateFlow<List<Group>> = _groups.asStateFlow()

    private val _appGroups = MutableStateFlow<Map<String, String>>(emptyMap())
    val appGroups: StateFlow<Map<String, String>> = _appGroups.asStateFlow()

    private val _lockoutEndTime = MutableStateFlow<Long?>(null)
    val lockoutEndTime: StateFlow<Long?> = _lockoutEndTime.asStateFlow()

    private val _installedApps = MutableStateFlow<List<InstalledApp>>(emptyList())
    val installedApps: StateFlow<List<InstalledApp>> = _installedApps.asStateFlow()

    /**
     * Origins whose access the user revoked. They can't silently reconnect;
     * reopening the app from the Apps tab asks the user first, and confirming
     * lifts the block (see [openDecision]).
     */
    private val _blockedOrigins = MutableStateFlow<Set<String>>(emptySet())

    /**
     * The one-time notice for installs that used cloud sync, gifts or relay
     * pairing before those were retired. The launch cleanup raises the flag;
     * it shows on one launch only.
     */
    private val retiredNotice = OneTimeNotice(
        isPending = { plainPrefs.getBoolean(RETIRED_FEATURES_NOTICE_FLAG, false) },
        clearPending = { plainPrefs.edit().remove(RETIRED_FEATURES_NOTICE_FLAG).apply() },
    )
    val retiredFeaturesNotice: StateFlow<Boolean> = retiredNotice.visible

    /** Released once the launch cleanup has finished (or given up). */
    private val launchCleanupDone = CountDownLatch(1)

    private var masterPassword: String? = null
    private var backgroundTime: Long? = null

    private val autoLockTimeout = 900_000L // 15 minutes

    init {
        // Off the main thread: it reads and rewrites the encrypted store.
        CoroutineScope(Dispatchers.IO).launch {
            try {
                purgeRetiredServiceData()
                retiredNotice.load()
            } catch (_: Exception) {
                // Best-effort; retried next launch.
            } finally {
                launchCleanupDone.countDown()
            }
        }
        _status.value = if (prefs.contains("password_hash")) WalletStatus.LOCKED else WalletStatus.UNINITIALIZED
        restoreLockoutState()
        loadInstalledApps()
        _blockedOrigins.value = plainPrefs.getStringSet(BLOCKED_ORIGINS_KEY, emptySet())?.toSet() ?: emptySet()
    }

    val isUnlocked: Boolean get() = _status.value == WalletStatus.UNLOCKED

    // MARK: - Password

    /**
     * Create the wallet's master password. The 600k-iteration PBKDF2 hash
     * runs on [Dispatchers.Default], so this is safe to call from the UI.
     */
    suspend fun createPassword(password: String) = withContext(Dispatchers.Default) {
        val hash = CryptoService.hashPassword(password)
        prefs.edit().putString("password_hash", hash).apply()
        masterPassword = password
        awaitLaunchCleanup()
        loadGroups()
        loadAppGroups()
        ensureDefaultGroup()
        loadInstalledApps()
        _status.value = WalletStatus.UNLOCKED
    }

    /**
     * Verify the master password and load the wallet. The PBKDF2 check and
     * the loads run on [Dispatchers.Default]; status flips to UNLOCKED only
     * once everything is loaded, so the main screen never shows a half-empty
     * wallet.
     */
    suspend fun unlock(password: String): UnlockResult = withContext(Dispatchers.Default) { unlockBlocking(password) }

    /**
     * Re-check the master password right before a sensitive action (export).
     * Shares the unlock brute-force counter and lockout, so an unlocked phone
     * can't be used to guess the password. PBKDF2 runs on Dispatchers.Default.
     */
    suspend fun confirmMasterPassword(password: String): UnlockResult = withContext(Dispatchers.Default) {
        val now = System.currentTimeMillis()
        val endTime = _lockoutEndTime.value
        if (endTime != null && now < endTime) {
            return@withContext UnlockResult.LockedOut(maxOf(1, ((endTime - now) / 1000).toInt()))
        }
        val hash = prefs.getString("password_hash", null) ?: return@withContext UnlockResult.WrongPassword
        if (!CryptoService.verifyPassword(password, hash)) {
            handleFailedAttempt()
            return@withContext UnlockResult.WrongPassword
        }
        resetFailedAttempts()
        UnlockResult.Success
    }

    private fun unlockBlocking(password: String): UnlockResult {
        val now = System.currentTimeMillis()
        val endTime = _lockoutEndTime.value
        if (endTime != null && now < endTime) {
            return UnlockResult.LockedOut(maxOf(1, ((endTime - now) / 1000).toInt()))
        }

        val hash = prefs.getString("password_hash", null) ?: return UnlockResult.WrongPassword
        if (!CryptoService.verifyPassword(password, hash)) {
            handleFailedAttempt()
            return UnlockResult.WrongPassword
        }

        resetFailedAttempts()
        masterPassword = password
        awaitLaunchCleanup()
        loadCredentials()
        pruneRemovedProviders()
        loadGroups()
        loadAppGroups()
        ensureDefaultGroup()
        loadSessions()
        loadRequestLogs()
        loadTokenAllowances()
        loadInstalledApps()
        _status.value = WalletStatus.UNLOCKED
        return UnlockResult.Success
    }

    fun lock() {
        masterPassword = null
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
        _tokenAllowances.value = emptyList()
        _groups.value = emptyList()
        _appGroups.value = emptyMap()
        _installedApps.value = emptyList()
        _status.value = WalletStatus.LOCKED
        backgroundTime = null
    }

    // MARK: - Brute-Force Protection

    private var failedAttempts: Int
        get() = plainPrefs.getInt("failedUnlockAttempts", 0)
        set(value) = plainPrefs.edit().putInt("failedUnlockAttempts", value).apply()

    private fun handleFailedAttempt() {
        failedAttempts++
        val duration = lockoutDuration(failedAttempts)
        if (duration != null) {
            val endTime = System.currentTimeMillis() + duration
            _lockoutEndTime.value = endTime
            plainPrefs.edit().putLong("lockoutEndTime", endTime).apply()
        }
    }

    private fun resetFailedAttempts() {
        failedAttempts = 0
        _lockoutEndTime.value = null
        plainPrefs.edit().putLong("lockoutEndTime", 0L).apply()
    }

    private fun restoreLockoutState() {
        val endTime = plainPrefs.getLong("lockoutEndTime", 0L)
        if (endTime > 0 && System.currentTimeMillis() < endTime) {
            _lockoutEndTime.value = endTime
        } else {
            plainPrefs.edit().putLong("lockoutEndTime", 0L).apply()
        }
    }

    private fun lockoutDuration(attempts: Int): Long? {
        if (attempts < 5) return null
        if (attempts < 10) return 30_000L
        if (attempts < 15) return 300_000L
        return 1_800_000L
    }

    // MARK: - Auto-Lock

    fun recordBackgroundTime() {
        if (_status.value == WalletStatus.UNLOCKED) {
            backgroundTime = System.currentTimeMillis()
        }
    }

    fun checkAutoLock() {
        val bg = backgroundTime
        backgroundTime = null
        if (_status.value == WalletStatus.UNLOCKED && bg != null &&
            System.currentTimeMillis() - bg > autoLockTimeout
        ) {
            lock()
        }
    }

    // MARK: - Credentials

    /**
     * Add a credential. Encrypting the key is a 600k-iteration PBKDF2, so the
     * whole thing runs on [Dispatchers.Default]; safe to call from the UI.
     */
    suspend fun addCredential(providerId: String, label: String, apiKey: String, authMethod: AuthMethod = AuthMethod.API_KEY, baseUrl: String? = null) = withContext(Dispatchers.Default) {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        // Fixed-host providers never keep a base URL; the others must have a safe one.
        val safeBaseUrl = CredentialBaseUrl.normalize(providerId, baseUrl)
        if (CredentialBaseUrl.isRequired(providerId) && safeBaseUrl == null) {
            throw IllegalArgumentException("A valid server URL is required for this provider")
        }
        val credential = Credential(providerId = providerId, label = label, authMethod = authMethod, baseUrl = safeBaseUrl)
        // Local providers may legitimately ship with an empty key
        // (unauthenticated server). Only persist ciphertext when a key was
        // actually supplied — decryptKey handles the missing-entry case.
        if (apiKey.isNotEmpty()) {
            val encrypted = CryptoService.encrypt(apiKey, password)
            prefs.edit().putString("key_${credential.id}", encrypted).apply()
        }
        _credentials.update { it + credential }
        saveCredentials()
    }

    fun removeCredential(credential: Credential) {
        prefs.edit().remove("key_${credential.id}").apply()
        _credentials.value = _credentials.value.filter { it.id != credential.id }
        saveCredentials()
    }

    fun updateCredentialLabel(credentialId: String, newLabel: String) {
        val trimmed = newLabel.trim()
        if (trimmed.isEmpty()) return
        val current = _credentials.value
        val idx = current.indexOfFirst { it.id == credentialId }
        if (idx < 0) return
        if (current[idx].label == trimmed) return
        _credentials.value = current.toMutableList().apply {
            this[idx] = this[idx].copy(label = trimmed)
        }
        saveCredentials()
    }

    fun decryptKey(credential: Credential): String {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        val encrypted = prefs.getString("key_${credential.id}", null)
        if (encrypted == null) {
            // Local providers may be stored with no keychain entry at all
            // (unauthenticated server). Treat that as an empty key rather
            // than an error so callers can fall through to the "no auth"
            // header path.
            if (credential.providerId == "ollama" || credential.providerId == "lm_studio") return ""
            throw IllegalStateException("Key not found")
        }
        return CryptoService.decrypt(encrypted, password)
    }

    // MARK: - Backup support

    /**
     * Plaintext secrets of [credentials], decrypted in parallel (one PBKDF2
     * each). Entries that can't be decrypted map to null. CPU-heavy: runs on
     * [Dispatchers.Default]; [onStep] fires from worker threads.
     */
    suspend fun decryptSecrets(
        credentials: List<Credential>,
        onStep: () -> Unit = {},
    ): List<String?> = coroutineScope {
        if (masterPassword == null) throw IllegalStateException("Wallet locked")
        credentials.map { cred ->
            async(Dispatchers.Default) {
                try { decryptKey(cred) } catch (_: Exception) { null }.also { onStep() }
            }
        }.awaitAll()
    }

    /**
     * Append credentials restored from a backup. Each gets the id already
     * assigned in [items] (fresh, never an existing one) and its secret is
     * encrypted under the master password like any other key. Existing
     * credentials are not touched. Encryption runs in parallel on
     * [Dispatchers.Default]; the final write is not cancellable so a
     * half-written import can't happen.
     */
    suspend fun addImportedCredentials(
        items: List<BackupFile.PlainCredential>,
        onStep: () -> Unit = {},
    ): List<Credential> {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        val existingIds = _credentials.value.mapTo(HashSet()) { it.id }
        val prepared = coroutineScope {
            items.map { item ->
                async(Dispatchers.Default) {
                    require(item.id !in existingIds) { "Credential id collision" }
                    val safeBaseUrl = CredentialBaseUrl.normalize(item.providerId, item.baseUrl)
                    require(!CredentialBaseUrl.isRequired(item.providerId) || safeBaseUrl != null) { "Unsafe server URL" }
                    val credential = Credential(
                        id = item.id,
                        providerId = item.providerId,
                        label = item.label,
                        authMethod = item.authMethod,
                        createdAt = minOf(item.createdAt, System.currentTimeMillis()),
                        baseUrl = safeBaseUrl,
                    )
                    // Keyless local providers have no keychain entry, same as addCredential.
                    val encrypted = if (item.secret.isNotEmpty()) {
                        CryptoService.encrypt(item.secret, password).also { onStep() }
                    } else null
                    credential to encrypted
                }
            }.awaitAll()
        }
        return withContext(NonCancellable + Dispatchers.IO) {
            // Keys first, then the list that references them.
            val editor = prefs.edit()
            prepared.forEach { (cred, encrypted) -> if (encrypted != null) editor.putString("key_${cred.id}", encrypted) }
            if (!editor.commit()) throw IllegalStateException("Could not save the imported keys")
            val added = prepared.map { it.first }
            _credentials.update { it + added }
            saveCredentials()
            added
        }
    }

    // MARK: - Sessions

    /**
     * How long a connected app stays listed without reconnecting. Sessions
     * are durable trust records (like the extension's), not live sockets:
     * the user revokes them explicitly from the Connected tab.
     */
    private val sessionTtlMs: Long = 30L * 24 * 60 * 60 * 1000

    /**
     * Upsert a session for `appOrigin`. Called by the in-wallet app bridge
     * when an app connects, so it shows up in the Connected tab. Connecting
     * the same origin again refreshes the providers list and the expiry but
     * keeps the existing session id.
     */
    fun upsertSession(appOrigin: String, providers: List<String>): Session {
        val now = System.currentTimeMillis()
        val expiresAt = now + sessionTtlMs

        val existing = _sessions.value.firstOrNull { it.appOrigin == appOrigin }
        if (existing != null) {
            val updated = existing.copy(providers = providers, expiresAt = expiresAt)
            _sessions.value = _sessions.value.map { if (it.id == existing.id) updated else it }
            saveSessions()
            return updated
        }

        val session = Session(
            id = java.util.UUID.randomUUID().toString(),
            appOrigin = appOrigin,
            sessionKey = java.util.UUID.randomUUID().toString(),
            providers = providers,
            createdAt = now,
            expiresAt = expiresAt,
        )
        _sessions.value = _sessions.value + session
        saveSessions()
        return session
    }

    /**
     * Disconnect an app. Its origin is also blocked from reconnecting on its
     * own until the user confirms reopening it from the Apps tab ([allowOrigin]).
     */
    fun revokeSession(session: Session) {
        _sessions.value = _sessions.value.filter { it.id != session.id }
        saveSessions()
        setBlockedOrigins(_blockedOrigins.value + session.appOrigin)
    }

    fun isOriginBlocked(origin: String): Boolean = origin in _blockedOrigins.value

    /** Whether [app] opens right away or first asks to reconnect (revoked origin). */
    fun openDecision(app: InstalledApp): AppOpenGate.Decision = AppOpenGate.decide(app, _blockedOrigins.value)

    /** The user confirmed reconnecting this app: lift the revoke. */
    fun allowOrigin(origin: String) {
        if (origin in _blockedOrigins.value) setBlockedOrigins(_blockedOrigins.value - origin)
    }

    private fun setBlockedOrigins(origins: Set<String>) {
        _blockedOrigins.value = origins
        plainPrefs.edit().putStringSet(BLOCKED_ORIGINS_KEY, origins).apply()
    }

    // MARK: - Reset

    fun resetWallet() {
        masterPassword = null
        backgroundTime = null

        // Load credential IDs from prefs even when locked,
        // so we can delete individual encrypted key entries
        var credentialIds = _credentials.value.map { it.id }
        if (credentialIds.isEmpty()) {
            val json = prefs.getString("credentials", null)
            if (json != null) {
                try {
                    val arr = JSONArray(json)
                    credentialIds = (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }
                } catch (_: Exception) {}
            }
        }

        // Delete all encrypted keys
        val editor = prefs.edit()
        credentialIds.forEach { editor.remove("key_$it") }
        editor.remove("password_hash")
        editor.remove("credentials")
        editor.remove("sessions")
        editor.remove("requestLogs")
        editor.remove("tokenAllowances")
        editor.remove("groups")
        editor.remove("appGroups")
        editor.apply()

        // Clear in-memory state
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
        _tokenAllowances.value = emptyList()
        _groups.value = emptyList()
        _appGroups.value = emptyMap()
        _installedApps.value = emptyList()
        retiredNotice.dismiss()
        _blockedOrigins.value = emptySet()
        plainPrefs.edit()
            .remove("installed_apps")
            .remove(BLOCKED_ORIGINS_KEY)
            .apply()

        // Reset brute-force state
        failedAttempts = 0
        _lockoutEndTime.value = null
        plainPrefs.edit()
            .putLong("lockoutEndTime", 0L)
            .putInt("failedUnlockAttempts", 0)
            .apply()

        _status.value = WalletStatus.UNINITIALIZED
    }

    // MARK: - Installed Apps

    private fun loadInstalledApps() {
        val json = plainPrefs.getString("installed_apps", null) ?: run {
            _installedApps.value = emptyList()
            return
        }
        val apps = mutableListOf<InstalledApp>()
        try {
            val arr = JSONArray(json)
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                // Entries written by older builds carry extra registry
                // metadata (slug, icon, author…); only the fields below
                // matter now. Anything that isn't a valid https URL is
                // dropped rather than opened.
                val valid = AppUrl.normalize(o.optString("url", "")) as? AppUrl.Result.Valid ?: continue
                val id = o.optString("id", "").ifEmpty { java.util.UUID.randomUUID().toString() }
                apps.add(InstalledApp(
                    id = id,
                    name = o.optString("name", "").ifBlank { valid.suggestedName },
                    url = valid.url,
                    installedAt = o.optLong("installedAt", 0),
                    enabled = o.optBoolean("enabled", true),
                ))
            }
        } catch (_: Exception) {}
        _installedApps.value = apps
    }

    private fun saveInstalledApps() {
        val arr = JSONArray()
        for (app in _installedApps.value) {
            arr.put(JSONObject().apply {
                put("id", app.id)
                put("name", app.name)
                put("url", app.url)
                put("installedAt", app.installedAt)
                put("enabled", app.enabled)
            })
        }
        plainPrefs.edit().putString("installed_apps", arr.toString()).apply()
    }

    sealed class AddAppResult {
        data class Added(val app: InstalledApp) : AddAppResult()
        data class Rejected(val reason: String) : AddAppResult()
    }

    /**
     * "Add app by URL". Only https URLs are accepted (see [AppUrl.normalize]);
     * the name defaults to the host when left blank. The same URL can't be
     * added twice.
     */
    fun addAppByUrl(input: String, name: String? = null): AddAppResult {
        val valid = when (val r = AppUrl.normalize(input)) {
            is AppUrl.Result.Invalid -> return AddAppResult.Rejected(r.reason)
            is AppUrl.Result.Valid -> r
        }
        if (_installedApps.value.any { it.url == valid.url }) {
            return AddAppResult.Rejected("That app is already in your list")
        }
        val app = InstalledApp(
            id = java.util.UUID.randomUUID().toString(),
            name = name?.trim()?.take(60)?.ifEmpty { null } ?: valid.suggestedName,
            url = valid.url,
        )
        _installedApps.value = _installedApps.value + app
        saveInstalledApps()
        return AddAppResult.Added(app)
    }

    fun uninstallApp(id: String) {
        _installedApps.value = _installedApps.value.filter { it.id != id }
        saveInstalledApps()
    }

    fun toggleApp(id: String) {
        _installedApps.value = _installedApps.value.map {
            if (it.id == id) it.copy(enabled = !it.enabled) else it
        }
        saveInstalledApps()
    }

    // MARK: - Request Logging

    fun logRequest(
        appOrigin: String,
        providerId: String,
        method: String,
        url: String,
        statusCode: Int,
        requestBody: ByteArray?,
        responseBody: String?,
        actualProviderId: String? = null,
        actualModel: String? = null,
        groupId: String? = null,
    ) {
        var sanitizedUrl = url
        val queryIndex = url.indexOf('?')
        if (queryIndex >= 0) sanitizedUrl = url.substring(0, queryIndex)

        val model = UsageParser.parseModel(requestBody)
        var inputTokens: Int? = null
        var outputTokens: Int? = null

        if (responseBody != null) {
            // Use upstream provider for usage parsing if we routed cross-family —
            // the response shape matches the destination, not the source.
            val parseProviderId = actualProviderId ?: providerId
            val usage = UsageParser.parseUsage(parseProviderId, responseBody)
            inputTokens = usage?.inputTokens
            outputTokens = usage?.outputTokens
        }

        // Tag the entry with the capability fingerprint of the source request
        // body (tools / vision / structured output / extended reasoning). The
        // Apps screen aggregates these per-app to warn before moving an app
        // to a group whose model lacks one of those features. Best-effort —
        // skipped on devices without JavaScriptSandbox support.
        val usedCapabilities: CapabilitySet? = try {
            if (TranslationEngine.get(appContext).isSupported && requestBody != null) {
                val bodyString = requestBody.toString(Charsets.UTF_8)
                val json = TranslationEngine.get(appContext).detectRequestCapabilities(bodyString)
                val parsed = JSONObject(json)
                CapabilitySet(
                    tools = parsed.optBoolean("tools"),
                    vision = parsed.optBoolean("vision"),
                    structuredOutput = parsed.optBoolean("structuredOutput"),
                    reasoning = parsed.optBoolean("reasoning"),
                )
            } else null
        } catch (_: Throwable) { null }

        val entry = RequestLog(
            appOrigin = appOrigin,
            providerId = providerId,
            method = method,
            url = sanitizedUrl,
            statusCode = statusCode,
            model = model,
            inputTokens = inputTokens,
            outputTokens = outputTokens,
            actualProviderId = actualProviderId,
            actualModel = actualModel,
            groupId = groupId,
            usedCapabilities = usedCapabilities,
        )

        val logs = listOf(entry) + _requestLogs.value
        _requestLogs.value = if (logs.size > 500) logs.take(500) else logs
        saveRequestLogs()
    }

    // MARK: - Persistence

    private fun loadCredentials() {
        val json = prefs.getString("credentials", null) ?: return
        val arr = JSONArray(json)
        val list = mutableListOf<Credential>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            list.add(
                Credential(
                    id = obj.getString("id"),
                    providerId = obj.getString("providerId"),
                    label = obj.getString("label"),
                    authMethod = AuthMethod.valueOf(obj.optString("authMethod", "API_KEY")),
                    createdAt = obj.getLong("createdAt"),
                    baseUrl = obj.optString("baseUrl", "").ifEmpty { null },
                )
            )
        }
        _credentials.value = list
    }

    /**
     * Drop any stored credentials that reference providers we've removed from
     * the registry (replicate, huggingface, the legacy "azure-openai" id).
     * Runs once per unlock; cheap if there's nothing to do.
     */
    private fun pruneRemovedProviders() {
        val stale = _credentials.value.filter { it.providerId in Provider.removedProviderIds }
        if (stale.isEmpty()) return
        val editor = prefs.edit()
        stale.forEach { editor.remove("key_${it.id}") }
        editor.apply()
        _credentials.value = _credentials.value.filterNot { it.providerId in Provider.removedProviderIds }
        saveCredentials()
    }

    // ──────────────────────────────────────────────────────────────────────
    // Groups
    //
    // Mobile uses the default group as a global routing rule because the SDK
    // protocol doesn't yet carry per-app origin. Multi-group CRUD is wired
    // through for parity with the extension and forward compat.
    // ──────────────────────────────────────────────────────────────────────

    private fun loadGroups() {
        val json = prefs.getString("groups", null) ?: run {
            _groups.value = emptyList()
            return
        }
        try {
            val arr = JSONArray(json)
            val list = mutableListOf<Group>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    Group(
                        id = obj.getString("id"),
                        name = obj.getString("name"),
                        providerId = obj.getString("providerId"),
                        credentialId = if (obj.has("credentialId") && !obj.isNull("credentialId")) obj.getString("credentialId") else null,
                        model = if (obj.has("model") && !obj.isNull("model")) obj.getString("model") else null,
                        createdAt = obj.optLong("createdAt", System.currentTimeMillis()),
                    )
                )
            }
            _groups.value = list
        } catch (_: Exception) {
            _groups.value = emptyList()
        }
    }

    private fun saveGroups() {
        val arr = JSONArray()
        _groups.value.forEach { g ->
            arr.put(JSONObject().apply {
                put("id", g.id)
                put("name", g.name)
                put("providerId", g.providerId)
                if (g.credentialId != null) put("credentialId", g.credentialId)
                if (g.model != null) put("model", g.model)
                put("createdAt", g.createdAt)
            })
        }
        prefs.edit().putString("groups", arr.toString()).apply()
    }

    private fun loadAppGroups() {
        val json = prefs.getString("appGroups", null) ?: run {
            _appGroups.value = emptyMap()
            return
        }
        try {
            val obj = JSONObject(json)
            val map = mutableMapOf<String, String>()
            obj.keys().forEach { key -> map[key] = obj.getString(key) }
            _appGroups.value = map
        } catch (_: Exception) {
            _appGroups.value = emptyMap()
        }
    }

    private fun saveAppGroups() {
        val obj = JSONObject()
        _appGroups.value.forEach { (k, v) -> obj.put(k, v) }
        prefs.edit().putString("appGroups", obj.toString()).apply()
    }

    /**
     * Make sure the default group exists as a routing-neutral sentinel.
     * Apps with no explicit binding land here; the resolver sees an empty
     * providerId and falls through to direct credential lookup.
     */
    private fun ensureDefaultGroup() {
        val existing = _groups.value.firstOrNull { it.id == DEFAULT_GROUP_ID }
        if (existing != null) {
            // Migrate stale default groups that were auto-populated with a
            // provider binding (pre-sentinel behavior).
            if (existing.providerId.isNotEmpty() || existing.credentialId != null) {
                val sentinel = existing.copy(providerId = "", credentialId = null)
                _groups.value = _groups.value.map { if (it.id == DEFAULT_GROUP_ID) sentinel else it }
                saveGroups()
            }
            return
        }
        _groups.value = listOf(Group.makeDefault()) + _groups.value
        saveGroups()
    }

    /**
     * Returns the group that should route this origin's requests — the user's
     * per-app binding from `appGroups`, falling back to the default group when
     * no binding exists. Used by `ProxyService` before each upstream call.
     */
    fun groupForOrigin(origin: String): Group? {
        val bound = _appGroups.value[origin]
        if (bound != null) {
            val match = _groups.value.firstOrNull { it.id == bound }
            if (match != null) return match
        }
        return _groups.value.firstOrNull { it.id == DEFAULT_GROUP_ID }
    }

    /**
     * Bind an app origin to a group. Called from the Apps screen when the
     * user assigns a connected app to a group (the per-app routing knob).
     * `RoutingResolver` picks this up on the next request via
     * `groupForOrigin()` — no other plumbing required.
     */
    fun setAppGroup(origin: String, groupId: String) {
        if (_groups.value.none { it.id == groupId }) throw GroupError.NotFound()
        _appGroups.value = _appGroups.value + (origin to groupId)
        saveAppGroups()
    }

    sealed class GroupError(message: String) : RuntimeException(message) {
        class NameInvalid : GroupError("Group name must be 1–200 characters")
        class NameDuplicate : GroupError("A group with this name already exists")
        class ProviderInvalid : GroupError("Invalid provider")
        class CredentialNotFound : GroupError("Credential not found")
        class CredentialMismatch : GroupError("Credential does not match provider")
        class NotFound : GroupError("Group not found")
        class CannotDeleteDefault : GroupError("Cannot delete the default group")
    }

    fun createGroup(
        name: String,
        providerId: String,
        credentialId: String? = null,
        model: String? = null,
    ): Group {
        val trimmed = name.trim()
        if (trimmed.isEmpty() || trimmed.length > 200) throw GroupError.NameInvalid()
        if (Provider.find(providerId) == null) throw GroupError.ProviderInvalid()
        if (credentialId != null) {
            val cred = _credentials.value.firstOrNull { it.id == credentialId }
                ?: throw GroupError.CredentialNotFound()
            if (cred.providerId != providerId) throw GroupError.CredentialMismatch()
        }
        if (_groups.value.any { it.name.equals(trimmed, ignoreCase = true) }) {
            throw GroupError.NameDuplicate()
        }
        val group = Group(
            id = java.util.UUID.randomUUID().toString(),
            name = trimmed,
            providerId = providerId,
            credentialId = credentialId,
            model = model?.trim()?.takeIf { it.isNotEmpty() },
        )
        _groups.value = _groups.value + group
        saveGroups()
        return group
    }

    /**
     * Update a group. Pass nulls for fields you don't want to change. To
     * explicitly UNSET credentialId / model, pass the corresponding unset***
     * flag — the credentialId / model string args are ignored when the flag
     * is set.
     *
     * Why a sentinel rather than a triple-state Optional<Optional<String>>:
     * Kotlin doesn't have a clean way to express "missing vs. nullable" for
     * single-string params, and adding a sealed-class wrapper is overkill.
     */
    fun updateGroup(
        id: String,
        name: String? = null,
        providerId: String? = null,
        credentialId: String? = null,
        model: String? = null,
        unsetCredentialId: Boolean = false,
        unsetModel: Boolean = false,
    ): Group {
        val idx = _groups.value.indexOfFirst { it.id == id }
        if (idx < 0) throw GroupError.NotFound()
        var next = _groups.value[idx]

        if (name != null) {
            val trimmed = name.trim()
            if (trimmed.isEmpty() || trimmed.length > 200) throw GroupError.NameInvalid()
            if (id != DEFAULT_GROUP_ID &&
                _groups.value.any { it.id != id && it.name.equals(trimmed, ignoreCase = true) }
            ) throw GroupError.NameDuplicate()
            next = next.copy(name = trimmed)
        }
        if (providerId != null) {
            if (Provider.find(providerId) == null) throw GroupError.ProviderInvalid()
            // Provider change invalidates the pin unless this same patch sets one.
            next = next.copy(
                providerId = providerId,
                credentialId = if (credentialId != null || unsetCredentialId) next.credentialId else null,
            )
        }
        if (unsetCredentialId) {
            next = next.copy(credentialId = null)
        } else if (credentialId != null) {
            val cred = _credentials.value.firstOrNull { it.id == credentialId }
                ?: throw GroupError.CredentialNotFound()
            if (cred.providerId != next.providerId) throw GroupError.CredentialMismatch()
            next = next.copy(credentialId = credentialId)
        }
        if (unsetModel) {
            next = next.copy(model = null)
        } else if (model != null) {
            next = next.copy(model = model.trim().takeIf { it.isNotEmpty() })
        }

        val updated = _groups.value.toMutableList().also { it[idx] = next }
        _groups.value = updated
        saveGroups()
        return next
    }

    fun deleteGroup(id: String) {
        if (id == DEFAULT_GROUP_ID) throw GroupError.CannotDeleteDefault()
        if (_groups.value.none { it.id == id }) throw GroupError.NotFound()
        _groups.value = _groups.value.filterNot { it.id == id }
        saveGroups()
        // Reassign any apps that pointed at this group back to the default.
        if (_appGroups.value.containsValue(id)) {
            _appGroups.value = _appGroups.value.mapValues { (_, gid) ->
                if (gid == id) DEFAULT_GROUP_ID else gid
            }
            saveAppGroups()
        }
    }

    private fun saveCredentials() {
        val arr = JSONArray()
        _credentials.value.forEach { c ->
            arr.put(JSONObject().apply {
                put("id", c.id)
                put("providerId", c.providerId)
                put("label", c.label)
                put("authMethod", c.authMethod.name)
                put("createdAt", c.createdAt)
                c.baseUrl?.let { put("baseUrl", it) }
            })
        }
        prefs.edit().putString("credentials", arr.toString()).apply()
    }

    private fun loadSessions() {
        val json = prefs.getString("sessions", null) ?: return
        val arr = JSONArray(json)
        val list = mutableListOf<Session>()
        for (i in 0 until arr.length()) {
            val obj = arr.getJSONObject(i)
            list.add(
                Session(
                    id = obj.getString("id"),
                    appOrigin = obj.getString("appOrigin"),
                    sessionKey = obj.getString("sessionKey"),
                    providers = List(obj.getJSONArray("providers").length()) {
                        obj.getJSONArray("providers").getString(it)
                    },
                    createdAt = obj.getLong("createdAt"),
                    expiresAt = obj.getLong("expiresAt"),
                )
            )
        }
        _sessions.value = list.filter { !it.isExpired }
    }

    private fun saveSessions() {
        val arr = JSONArray()
        _sessions.value.forEach { s ->
            arr.put(JSONObject().apply {
                put("id", s.id)
                put("appOrigin", s.appOrigin)
                put("sessionKey", s.sessionKey)
                put("providers", JSONArray(s.providers))
                put("createdAt", s.createdAt)
                put("expiresAt", s.expiresAt)
            })
        }
        prefs.edit().putString("sessions", arr.toString()).apply()
    }

    private fun loadRequestLogs() {
        val json = prefs.getString("requestLogs", null) ?: return
        try {
            val arr = JSONArray(json)
            val list = mutableListOf<RequestLog>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val capsObj = obj.optJSONObject("usedCapabilities")
                val caps = if (capsObj != null) CapabilitySet(
                    tools = capsObj.optBoolean("tools"),
                    vision = capsObj.optBoolean("vision"),
                    structuredOutput = capsObj.optBoolean("structuredOutput"),
                    reasoning = capsObj.optBoolean("reasoning"),
                ) else null
                list.add(
                    RequestLog(
                        id = obj.getString("id"),
                        appOrigin = obj.getString("appOrigin"),
                        providerId = obj.getString("providerId"),
                        method = obj.getString("method"),
                        url = obj.getString("url"),
                        statusCode = obj.getInt("statusCode"),
                        timestamp = obj.getLong("timestamp"),
                        inputTokens = if (obj.has("inputTokens")) obj.optInt("inputTokens") else null,
                        outputTokens = if (obj.has("outputTokens")) obj.optInt("outputTokens") else null,
                        model = obj.optString("model", "").takeIf { it.isNotEmpty() },
                        usedCapabilities = caps,
                    )
                )
            }
            _requestLogs.value = list
        } catch (_: Exception) {
            _requestLogs.value = emptyList()
        }
    }

    private fun saveRequestLogs() {
        val arr = JSONArray()
        _requestLogs.value.forEach { r ->
            arr.put(JSONObject().apply {
                put("id", r.id)
                put("appOrigin", r.appOrigin)
                put("providerId", r.providerId)
                put("method", r.method)
                put("url", r.url)
                put("statusCode", r.statusCode)
                put("timestamp", r.timestamp)
                r.inputTokens?.let { put("inputTokens", it) }
                r.outputTokens?.let { put("outputTokens", it) }
                r.model?.let { put("model", it) }
                r.usedCapabilities?.let { caps ->
                    put("usedCapabilities", JSONObject().apply {
                        put("tools", caps.tools)
                        put("vision", caps.vision)
                        put("structuredOutput", caps.structuredOutput)
                        put("reasoning", caps.reasoning)
                    })
                }
            })
        }
        prefs.edit().putString("requestLogs", arr.toString()).apply()
    }

    // MARK: - Token Allowances

    fun setAllowance(allowance: TokenAllowance) {
        val list = _tokenAllowances.value.toMutableList()
        val idx = list.indexOfFirst { it.origin == allowance.origin }
        if (idx >= 0) list[idx] = allowance else list.add(allowance)
        _tokenAllowances.value = list
        saveTokenAllowances()
    }

    fun removeAllowance(origin: String) {
        _tokenAllowances.value = _tokenAllowances.value.filter { it.origin != origin }
        saveTokenAllowances()
    }

    fun checkAllowance(origin: String, providerId: String): AllowanceCheck.Result {
        val allowance = _tokenAllowances.value.firstOrNull { it.origin == origin }
        val entries = _requestLogs.value.filter { it.appOrigin == origin && it.statusCode < 400 }
        return AllowanceCheck.compute(allowance, entries, providerId)
    }

    fun tokenUsage(origin: String): Int {
        return _requestLogs.value
            .filter { it.appOrigin == origin && it.statusCode < 400 }
            .sumOf { (it.inputTokens ?: 0) + (it.outputTokens ?: 0) }
    }

    private fun loadTokenAllowances() {
        val json = prefs.getString("tokenAllowances", null) ?: return
        try {
            val arr = JSONArray(json)
            val list = mutableListOf<TokenAllowance>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val providerLimits = if (obj.has("providerLimits")) {
                    val pl = obj.getJSONObject("providerLimits")
                    val map = mutableMapOf<String, Int>()
                    pl.keys().forEach { key -> map[key] = pl.getInt(key) }
                    map
                } else null
                list.add(
                    TokenAllowance(
                        origin = obj.getString("origin"),
                        totalLimit = if (obj.has("totalLimit")) obj.getInt("totalLimit") else null,
                        providerLimits = providerLimits,
                    )
                )
            }
            _tokenAllowances.value = list
        } catch (_: Exception) {
            _tokenAllowances.value = emptyList()
        }
    }

    private fun saveTokenAllowances() {
        val arr = JSONArray()
        _tokenAllowances.value.forEach { a ->
            arr.put(JSONObject().apply {
                put("origin", a.origin)
                a.totalLimit?.let { put("totalLimit", it) }
                a.providerLimits?.let { pl ->
                    put("providerLimits", JSONObject().apply {
                        pl.forEach { (k, v) -> put(k, v) }
                    })
                }
            })
        }
        prefs.edit().putString("tokenAllowances", arr.toString()).apply()
    }

    // MARK: - Retired service data

    /**
     * One-time, best-effort removal of state left behind by the hosted
     * services this wallet no longer talks to: cloud-sync account tokens and
     * key-wrapping material, gift and gift-link records, and relay pairing
     * sessions (every stored session was created by relay pairing, since
     * nothing else wrote sessions before the in-wallet browser existed).
     *
     * Only the keys named in [RETIRED_ENCRYPTED_KEYS] are removed, plus gift
     * pins inside `groups`. The password hash, the encrypted API keys
     * (`key_*`), `credentials`, app bindings, allowances and request logs are
     * never touched. Runs on a background thread at launch; a failure leaves
     * the done-flag unset so the next launch retries.
     */
    private fun purgeRetiredServiceData() {
        if (plainPrefs.getBoolean(RETIRED_DATA_PURGED_FLAG, false)) return

        // Record whether the user actually used a retired feature before the
        // evidence is deleted, so the Wallet screen can explain once.
        if (usedRetiredFeatures()) {
            plainPrefs.edit().putBoolean(RETIRED_FEATURES_NOTICE_FLAG, true).commit()
        }

        val editor = prefs.edit()
        RETIRED_ENCRYPTED_KEYS.forEach { editor.remove(it) }
        stripGroupPinsToRetiredItems()?.let { editor.putString("groups", it) }
        if (!editor.commit()) return
        plainPrefs.edit().putBoolean(RETIRED_DATA_PURGED_FLAG, true).commit()
    }

    private fun usedRetiredFeatures(): Boolean {
        fun flag(key: String) = try { prefs.getBoolean(key, false) } catch (_: Exception) { false }
        fun present(key: String) = try { !prefs.getString(key, null).isNullOrEmpty() } catch (_: Exception) { false }
        fun nonEmptyArray(key: String) = try {
            prefs.getString(key, null)?.let { JSONArray(it).length() > 0 } ?: false
        } catch (_: Exception) { false }

        val cloudSync = flag("cloudVault_enabled") ||
            present("cloudVault_username") ||
            present("cloudVault_lastUsername") ||
            present("cloudVault_token")
        val gifts = nonEmptyArray("gifts") || nonEmptyArray("giftedCredentials")
        val pairing = nonEmptyArray("sessions")
        return cloudSync || gifts || pairing
    }

    /** Groups could pin a received gift (`giftId`). Returns the rewritten
     *  `groups` JSON with those pins removed, or null when nothing changed. */
    private fun stripGroupPinsToRetiredItems(): String? {
        val json = prefs.getString("groups", null) ?: return null
        return try {
            val arr = JSONArray(json)
            var changed = false
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (obj.has("giftId")) {
                    obj.remove("giftId")
                    changed = true
                }
            }
            if (changed) arr.toString() else null
        } catch (_: Exception) { null }
    }

    /**
     * Unlock must not load sessions or groups while the cleanup may still be
     * rewriting them. The cleanup takes milliseconds and the user is still
     * typing the password, so this normally returns immediately.
     */
    private fun awaitLaunchCleanup() {
        try { launchCleanupDone.await(5, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
    }

    /**
     * The retired-features notice is on screen: no later launch shows it
     * again. It stays up for this session until dismissed.
     */
    fun markRetiredFeaturesNoticeShown() = retiredNotice.markShown()

    /** Hide the one-time retired-features notice for good. */
    fun dismissRetiredFeaturesNotice() = retiredNotice.dismiss()

    companion object {
        /** Name of the EncryptedSharedPreferences file holding local wallet data. */
        const val ENCRYPTED_PREFS_FILE = "byoky_vault"

        private const val RETIRED_DATA_PURGED_FLAG = "retiredServiceDataPurged_v1"
        private const val RETIRED_FEATURES_NOTICE_FLAG = "retiredFeaturesNoticePending"
        private const val BLOCKED_ORIGINS_KEY = "blockedOrigins"

        private val RETIRED_ENCRYPTED_KEYS = listOf(
            // Cloud sync account
            "cloudVault_enabled",
            "cloudVault_username",
            "cloudVault_lastUsername",
            "cloudVault_token",
            "cloudVault_sessionId",
            "cloudVault_tokenIssuedAt",
            "cloudVault_tokenExpired",
            "cloudVault_credentialMap",
            "cloudVault_credentialMeta",
            "cloudVault_lastSyncAt",
            "cloudVault_vaultKey",
            "vaultBannerDismissedAt",
            // Gifts (sent, received, per-provider preference)
            "gifts",
            "giftedCredentials",
            "giftPreferences",
            // Relay pairing sessions
            "sessions",
        )
    }
}
