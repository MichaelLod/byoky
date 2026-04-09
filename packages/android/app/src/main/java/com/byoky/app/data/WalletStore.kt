package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.byoky.app.crypto.CryptoService
import com.byoky.app.proxy.TranslationEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
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

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "byoky_vault",
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

    private val _gifts = MutableStateFlow<List<Gift>>(emptyList())
    val gifts: StateFlow<List<Gift>> = _gifts.asStateFlow()

    private val _giftedCredentials = MutableStateFlow<List<GiftedCredential>>(emptyList())
    val giftedCredentials: StateFlow<List<GiftedCredential>> = _giftedCredentials.asStateFlow()

    private val _giftPreferences = MutableStateFlow<Map<String, String>>(emptyMap())
    val giftPreferences: StateFlow<Map<String, String>> = _giftPreferences.asStateFlow()

    private val _tokenAllowances = MutableStateFlow<List<TokenAllowance>>(emptyList())
    val tokenAllowances: StateFlow<List<TokenAllowance>> = _tokenAllowances.asStateFlow()

    private val _groups = MutableStateFlow<List<Group>>(emptyList())
    val groups: StateFlow<List<Group>> = _groups.asStateFlow()

    private val _appGroups = MutableStateFlow<Map<String, String>>(emptyMap())
    val appGroups: StateFlow<Map<String, String>> = _appGroups.asStateFlow()

    private val _bridgeStatus = MutableStateFlow(BridgeStatus.INACTIVE)
    val bridgeStatus: StateFlow<BridgeStatus> = _bridgeStatus.asStateFlow()

    private val _lockoutEndTime = MutableStateFlow<Long?>(null)
    val lockoutEndTime: StateFlow<Long?> = _lockoutEndTime.asStateFlow()

    private val _cloudVaultEnabled = MutableStateFlow(false)
    val cloudVaultEnabled: StateFlow<Boolean> = _cloudVaultEnabled.asStateFlow()

    private val _cloudVaultUsername = MutableStateFlow<String?>(null)
    val cloudVaultUsername: StateFlow<String?> = _cloudVaultUsername.asStateFlow()

    private val _cloudVaultTokenExpired = MutableStateFlow(false)
    val cloudVaultTokenExpired: StateFlow<Boolean> = _cloudVaultTokenExpired.asStateFlow()

    private var masterPassword: String? = null
    private var backgroundTime: Long? = null
    private var vaultToken: String? = null
    private var vaultSessionId: String? = null
    private var vaultTokenIssuedAt: Long = 0
    private var vaultCredentialMap: ConcurrentHashMap<String, String> = ConcurrentHashMap()

    private val autoLockTimeout = 300_000L // 5 minutes

    private val vaultClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val vaultScope = CoroutineScope(Dispatchers.IO)

    init {
        _status.value = if (prefs.contains("password_hash")) WalletStatus.LOCKED else WalletStatus.UNINITIALIZED
        restoreLockoutState()
    }

    val isUnlocked: Boolean get() = _status.value == WalletStatus.UNLOCKED

    // MARK: - Password

    fun createPassword(password: String) {
        val hash = CryptoService.hashPassword(password)
        prefs.edit().putString("password_hash", hash).apply()
        masterPassword = password
        _status.value = WalletStatus.UNLOCKED
    }

    fun unlock(password: String): UnlockResult {
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
        _status.value = WalletStatus.UNLOCKED
        loadCredentials()
        pruneRemovedProviders()
        loadGroups()
        loadAppGroups()
        ensureDefaultGroup()
        loadSessions()
        loadRequestLogs()
        loadGifts()
        loadGiftedCredentials()
        loadGiftPreferences()
        loadTokenAllowances()
        loadCloudVaultState()
        vaultScope.launch { syncPendingCredentials() }
        return UnlockResult.Success
    }

    fun lock() {
        masterPassword = null
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
        _gifts.value = emptyList()
        _giftedCredentials.value = emptyList()
        _giftPreferences.value = emptyMap()
        _tokenAllowances.value = emptyList()
        _groups.value = emptyList()
        _appGroups.value = emptyMap()
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

    fun addCredential(providerId: String, label: String, apiKey: String, authMethod: AuthMethod = AuthMethod.API_KEY) {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        val credential = Credential(providerId = providerId, label = label, authMethod = authMethod)
        val encrypted = CryptoService.encrypt(apiKey, password)
        prefs.edit().putString("key_${credential.id}", encrypted).apply()
        _credentials.value = _credentials.value + credential
        saveCredentials()
        val localId = credential.id
        vaultScope.launch { syncAddToVault(localId, providerId, label, authMethod.name.lowercase(), apiKey) }
    }

    fun removeCredential(credential: Credential) {
        val localId = credential.id
        prefs.edit().remove("key_${credential.id}").apply()
        _credentials.value = _credentials.value.filter { it.id != credential.id }
        saveCredentials()
        vaultScope.launch { syncRemoveFromVault(localId) }
    }

    fun decryptKey(credential: Credential): String {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        val encrypted = prefs.getString("key_${credential.id}", null)
            ?: throw IllegalStateException("Key not found")
        return CryptoService.decrypt(encrypted, password)
    }

    // MARK: - Sessions

    /**
     * Default expiry window for relay-paired sessions. The pair stays in the
     * Apps screen for 30 days even if the WebSocket drops between requests —
     * the user revokes explicitly when they're done. Lines up with how the
     * extension treats sessions as durable trust records, not live sockets.
     */
    private val relaySessionTtlMs: Long = 30L * 24 * 60 * 60 * 1000

    /**
     * Upsert a session for `appOrigin`. Used by `RelayPairService` when a
     * pair handshake completes — durable record so the app shows up in the
     * Apps screen across reconnects. Re-pairing the same origin updates the
     * providers list and resets the expiry, but keeps the existing session id.
     */
    fun upsertSession(appOrigin: String, providers: List<String>): Session {
        val now = System.currentTimeMillis()
        val expiresAt = now + relaySessionTtlMs

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

    fun revokeSession(session: Session) {
        _sessions.value = _sessions.value.filter { it.id != session.id }
        saveSessions()
    }

    // MARK: - Gifts

    fun createGift(
        credentialId: String,
        providerId: String,
        label: String,
        maxTokens: Int,
        expiresInMs: Long,
        relayUrl: String,
    ): Gift {
        val gift = Gift(
            credentialId = credentialId,
            providerId = providerId,
            label = label,
            authToken = generateAuthToken(),
            maxTokens = maxTokens,
            expiresAt = System.currentTimeMillis() + expiresInMs,
            relayUrl = relayUrl,
        )
        _gifts.value = _gifts.value + gift
        saveGifts()
        return gift
    }

    fun revokeGift(id: String) {
        _gifts.value = _gifts.value.map {
            if (it.id == id) it.copy(active = false) else it
        }
        saveGifts()
    }

    fun redeemGift(encoded: String): Pair<Boolean, String?> {
        val link = decodeGiftLink(encoded) ?: return Pair(false, "Invalid gift link")
        val (valid, error) = validateGiftLink(link)
        if (!valid) return Pair(false, error)

        val existing = _giftedCredentials.value.any { it.giftId == link.id }
        if (existing) return Pair(false, "Gift already redeemed")

        val credential = GiftedCredential(
            giftId = link.id,
            providerId = link.p,
            providerName = link.n,
            senderLabel = link.s,
            authToken = link.t,
            maxTokens = link.m,
            expiresAt = link.e,
            relayUrl = link.r,
        )
        _giftedCredentials.value = _giftedCredentials.value + credential
        saveGiftedCredentials()
        return Pair(true, null)
    }

    fun removeGiftedCredential(id: String) {
        val gc = _giftedCredentials.value.find { it.id == id }
        if (gc != null && _giftPreferences.value[gc.providerId] == gc.giftId) {
            _giftPreferences.value = _giftPreferences.value - gc.providerId
            saveGiftPreferences()
        }
        _giftedCredentials.value = _giftedCredentials.value.filter { it.id != id }
        saveGiftedCredentials()
    }

    fun setGiftPreference(providerId: String, giftId: String?) {
        _giftPreferences.value = if (giftId != null) {
            _giftPreferences.value + (providerId to giftId)
        } else {
            _giftPreferences.value - providerId
        }
        saveGiftPreferences()
    }

    fun updateGiftedCredentialUsage(giftId: String, usedTokens: Int) {
        _giftedCredentials.value = _giftedCredentials.value.map { gc ->
            if (gc.giftId == giftId) gc.copy(usedTokens = usedTokens) else gc
        }
        saveGiftedCredentials()
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
        editor.remove("gifts")
        editor.remove("giftedCredentials")
        editor.remove("giftPreferences")
        editor.remove("tokenAllowances")
        editor.remove("cloudVault_enabled")
        editor.remove("cloudVault_username")
        editor.remove("cloudVault_token")
        editor.remove("cloudVault_sessionId")
        editor.remove("cloudVault_tokenIssuedAt")
        editor.remove("cloudVault_tokenExpired")
        editor.remove("cloudVault_credentialMap")
        editor.apply()

        _cloudVaultEnabled.value = false
        _cloudVaultUsername.value = null
        _cloudVaultTokenExpired.value = false
        vaultToken = null
        vaultSessionId = null
        vaultTokenIssuedAt = 0
        vaultCredentialMap.clear()

        // Clear in-memory state
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
        _gifts.value = emptyList()
        _giftedCredentials.value = emptyList()
        _tokenAllowances.value = emptyList()
        _bridgeStatus.value = BridgeStatus.INACTIVE

        // Reset brute-force state
        failedAttempts = 0
        _lockoutEndTime.value = null
        plainPrefs.edit()
            .putLong("lockoutEndTime", 0L)
            .putInt("failedUnlockAttempts", 0)
            .apply()

        _status.value = WalletStatus.UNINITIALIZED
    }

    // MARK: - Bridge

    fun setBridgeStatus(status: BridgeStatus) {
        _bridgeStatus.value = status
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
     * Make sure the default group exists. Called once per unlock. Picks a
     * sensible provider (first credential's, falling back to anthropic).
     */
    private fun ensureDefaultGroup() {
        if (_groups.value.any { it.id == DEFAULT_GROUP_ID }) return
        val first = _credentials.value.firstOrNull()
        val def = Group.makeDefault(
            providerId = first?.providerId ?: "anthropic",
            credentialId = first?.id,
        )
        _groups.value = listOf(def) + _groups.value
        saveGroups()
    }

    /**
     * Returns the group that should route this origin's requests — the user's
     * per-app binding from `appGroups`, falling back to the default group when
     * no binding exists. Used by both `ProxyService` and `RelayPairService`
     * before each upstream call.
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

    fun createGroup(name: String, providerId: String, credentialId: String? = null, model: String? = null): Group {
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
     * explicitly UNSET credentialId or model, pass the sentinel string ""
     * (empty string) — translated to null in the patch.
     *
     * Why a sentinel rather than a triple-state Optional<Optional<String>>:
     * Kotlin doesn't have a clean way to express "missing vs. nullable" for
     * single-string params, and adding a sealed-class wrapper for two fields
     * is overkill at the call sites we have.
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
            // Provider change invalidates credential pin unless this same patch sets it.
            next = next.copy(providerId = providerId, credentialId = if (credentialId != null || unsetCredentialId) next.credentialId else null)
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
        var mutated = false
        val newAppGroups = _appGroups.value.toMutableMap()
        for ((origin, gid) in _appGroups.value) {
            if (gid == id) {
                newAppGroups[origin] = DEFAULT_GROUP_ID
                mutated = true
            }
        }
        if (mutated) {
            _appGroups.value = newAppGroups
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

    private fun loadGifts() {
        val json = prefs.getString("gifts", null) ?: return
        try {
            val arr = JSONArray(json)
            val list = mutableListOf<Gift>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    Gift(
                        id = obj.getString("id"),
                        credentialId = obj.getString("credentialId"),
                        providerId = obj.getString("providerId"),
                        label = obj.getString("label"),
                        authToken = obj.getString("authToken"),
                        maxTokens = obj.getInt("maxTokens"),
                        usedTokens = obj.optInt("usedTokens", 0),
                        expiresAt = obj.getLong("expiresAt"),
                        createdAt = obj.getLong("createdAt"),
                        active = obj.optBoolean("active", true),
                        relayUrl = obj.getString("relayUrl"),
                    )
                )
            }
            _gifts.value = list
        } catch (_: Exception) {
            _gifts.value = emptyList()
        }
    }

    private fun saveGifts() {
        val arr = JSONArray()
        _gifts.value.forEach { g ->
            arr.put(JSONObject().apply {
                put("id", g.id)
                put("credentialId", g.credentialId)
                put("providerId", g.providerId)
                put("label", g.label)
                put("authToken", g.authToken)
                put("maxTokens", g.maxTokens)
                put("usedTokens", g.usedTokens)
                put("expiresAt", g.expiresAt)
                put("createdAt", g.createdAt)
                put("active", g.active)
                put("relayUrl", g.relayUrl)
            })
        }
        prefs.edit().putString("gifts", arr.toString()).apply()
    }

    private fun loadGiftedCredentials() {
        val json = prefs.getString("giftedCredentials", null) ?: return
        try {
            val arr = JSONArray(json)
            val list = mutableListOf<GiftedCredential>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                list.add(
                    GiftedCredential(
                        id = obj.getString("id"),
                        giftId = obj.getString("giftId"),
                        providerId = obj.getString("providerId"),
                        providerName = obj.getString("providerName"),
                        senderLabel = obj.getString("senderLabel"),
                        authToken = obj.getString("authToken"),
                        maxTokens = obj.getInt("maxTokens"),
                        usedTokens = obj.optInt("usedTokens", 0),
                        expiresAt = obj.getLong("expiresAt"),
                        relayUrl = obj.getString("relayUrl"),
                        createdAt = obj.getLong("createdAt"),
                    )
                )
            }
            _giftedCredentials.value = list
        } catch (_: Exception) {
            _giftedCredentials.value = emptyList()
        }
    }

    private fun saveGiftedCredentials() {
        val arr = JSONArray()
        _giftedCredentials.value.forEach { gc ->
            arr.put(JSONObject().apply {
                put("id", gc.id)
                put("giftId", gc.giftId)
                put("providerId", gc.providerId)
                put("providerName", gc.providerName)
                put("senderLabel", gc.senderLabel)
                put("authToken", gc.authToken)
                put("maxTokens", gc.maxTokens)
                put("usedTokens", gc.usedTokens)
                put("expiresAt", gc.expiresAt)
                put("relayUrl", gc.relayUrl)
                put("createdAt", gc.createdAt)
            })
        }
        prefs.edit().putString("giftedCredentials", arr.toString()).apply()
    }

    private fun loadGiftPreferences() {
        val json = prefs.getString("giftPreferences", null) ?: return
        try {
            val obj = JSONObject(json)
            val map = mutableMapOf<String, String>()
            obj.keys().forEach { key -> map[key] = obj.getString(key) }
            _giftPreferences.value = map
        } catch (_: Exception) {
            _giftPreferences.value = emptyMap()
        }
    }

    private fun saveGiftPreferences() {
        val obj = JSONObject()
        _giftPreferences.value.forEach { (k, v) -> obj.put(k, v) }
        prefs.edit().putString("giftPreferences", obj.toString()).apply()
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

    // MARK: - Cloud Vault

    companion object {
        private const val VAULT_URL = "https://vault.byoky.com"
        private val JSON_MEDIA = "application/json".toMediaType()
        private const val SIX_DAYS_MS = 6L * 24 * 60 * 60 * 1000
    }

    private fun loadCloudVaultState() {
        _cloudVaultEnabled.value = prefs.getBoolean("cloudVault_enabled", false)
        _cloudVaultUsername.value = prefs.getString("cloudVault_username", null)
        vaultToken = prefs.getString("cloudVault_token", null)
        vaultSessionId = prefs.getString("cloudVault_sessionId", null)
        vaultTokenIssuedAt = prefs.getLong("cloudVault_tokenIssuedAt", 0)
        _cloudVaultTokenExpired.value = prefs.getBoolean("cloudVault_tokenExpired", false)

        val mapJson = prefs.getString("cloudVault_credentialMap", null)
        vaultCredentialMap = if (mapJson != null) {
            try {
                val obj = JSONObject(mapJson)
                val map = ConcurrentHashMap<String, String>()
                obj.keys().forEach { key -> map[key] = obj.getString(key) }
                map
            } catch (_: Exception) { ConcurrentHashMap() }
        } else { ConcurrentHashMap() }

        if (_cloudVaultEnabled.value && vaultTokenIssuedAt > 0 &&
            System.currentTimeMillis() - vaultTokenIssuedAt > SIX_DAYS_MS) {
            _cloudVaultTokenExpired.value = true
            prefs.edit().putBoolean("cloudVault_tokenExpired", true).apply()
        }
    }

    private fun saveCloudVaultConfig() {
        prefs.edit()
            .putBoolean("cloudVault_enabled", _cloudVaultEnabled.value)
            .putString("cloudVault_username", _cloudVaultUsername.value)
            .putString("cloudVault_token", vaultToken)
            .putString("cloudVault_sessionId", vaultSessionId)
            .putLong("cloudVault_tokenIssuedAt", vaultTokenIssuedAt)
            .putBoolean("cloudVault_tokenExpired", _cloudVaultTokenExpired.value)
            .apply()
        saveVaultCredentialMap()
    }

    private fun saveVaultCredentialMap() {
        val obj = JSONObject()
        vaultCredentialMap.forEach { (k, v) -> obj.put(k, v) }
        prefs.edit().putString("cloudVault_credentialMap", obj.toString()).apply()
    }

    private fun vaultRequest(
        path: String,
        method: String,
        body: JSONObject? = null,
        token: String? = null,
    ): Triple<Boolean, Int, JSONObject> {
        return try {
            val builder = Request.Builder().url("$VAULT_URL$path")
            token?.let { builder.addHeader("Authorization", "Bearer $it") }

            when (method) {
                "POST" -> {
                    val reqBody = (body?.toString() ?: "{}").toRequestBody(JSON_MEDIA)
                    builder.post(reqBody)
                }
                "DELETE" -> builder.delete()
                else -> builder.get()
            }

            val response = vaultClient.newCall(builder.build()).execute()
            val responseBody = response.body?.string() ?: "{}"
            val json = try { JSONObject(responseBody) } catch (_: Exception) { JSONObject() }
            Triple(response.isSuccessful, response.code, json)
        } catch (_: Exception) {
            Triple(false, 0, JSONObject())
        }
    }

    fun checkUsernameAvailability(username: String): Pair<Boolean, String?> {
        val encoded = java.net.URLEncoder.encode(username, "UTF-8")
        val (ok, _, data) = vaultRequest("/auth/check-username/$encoded", "GET")
        if (!ok) return Pair(false, null)
        val available = data.optBoolean("available", false)
        val reason = data.optString("reason", "").takeIf { it.isNotEmpty() }
        return Pair(available, reason)
    }

    suspend fun enableCloudVault(username: String, password: String, isSignup: Boolean) {
        val path = if (isSignup) "/auth/signup" else "/auth/login"
        val body = JSONObject().put("username", username).put("password", password)
        val (ok, _, data) = vaultRequest(path, "POST", body)
        if (!ok) {
            val err = data.optJSONObject("error")
            throw IllegalStateException(err?.optString("message") ?: if (isSignup) "Signup failed" else "Login failed")
        }
        val token = data.getString("token")
        val sessionId = data.getString("sessionId")

        vaultToken = token
        vaultSessionId = sessionId
        vaultTokenIssuedAt = System.currentTimeMillis()
        _cloudVaultEnabled.value = true
        _cloudVaultUsername.value = username
        _cloudVaultTokenExpired.value = false
        vaultCredentialMap.clear()
        saveCloudVaultConfig()

        syncAllCredentialsToVault()
    }

    suspend fun disableCloudVault() {
        val token = vaultToken
        if (token != null && !_cloudVaultTokenExpired.value) {
            try { vaultRequest("/auth/logout", "POST", token = token) } catch (_: Exception) {}
        }

        _cloudVaultEnabled.value = false
        _cloudVaultUsername.value = null
        _cloudVaultTokenExpired.value = false
        vaultToken = null
        vaultSessionId = null
        vaultTokenIssuedAt = 0
        vaultCredentialMap.clear()
        prefs.edit()
            .remove("cloudVault_enabled")
            .remove("cloudVault_username")
            .remove("cloudVault_token")
            .remove("cloudVault_sessionId")
            .remove("cloudVault_tokenIssuedAt")
            .remove("cloudVault_tokenExpired")
            .remove("cloudVault_credentialMap")
            .apply()
    }

    suspend fun reloginCloudVault(password: String) {
        val username = _cloudVaultUsername.value ?: throw IllegalStateException("No vault account configured")
        val body = JSONObject().put("username", username).put("password", password)
        val (ok, _, data) = vaultRequest("/auth/login", "POST", body)
        if (!ok) {
            val err = data.optJSONObject("error")
            throw IllegalStateException(err?.optString("message") ?: "Login failed")
        }
        vaultToken = data.getString("token")
        vaultSessionId = data.getString("sessionId")
        vaultTokenIssuedAt = System.currentTimeMillis()
        _cloudVaultTokenExpired.value = false
        saveCloudVaultConfig()

        syncPendingCredentials()
    }

    private fun syncAddToVault(localId: String, providerId: String, label: String, authMethod: String, plainKey: String) {
        if (!_cloudVaultEnabled.value || vaultToken == null || _cloudVaultTokenExpired.value) return
        val token = vaultToken ?: return

        val body = JSONObject()
            .put("providerId", providerId)
            .put("apiKey", plainKey)
            .put("label", label)
            .put("authMethod", authMethod)
        val (ok, status, data) = vaultRequest("/credentials", "POST", body, token)

        if (status == 401) {
            _cloudVaultTokenExpired.value = true
            prefs.edit().putBoolean("cloudVault_tokenExpired", true).apply()
            return
        }
        if (ok) {
            val vaultId = data.optJSONObject("credential")?.optString("id")
            if (vaultId != null) {
                vaultCredentialMap[localId] = vaultId
                saveVaultCredentialMap()
            }
        }
    }

    private fun syncRemoveFromVault(localId: String) {
        if (!_cloudVaultEnabled.value || vaultToken == null || _cloudVaultTokenExpired.value) return
        val token = vaultToken ?: return
        val vaultId = vaultCredentialMap[localId] ?: return

        val (_, status, _) = vaultRequest("/credentials/$vaultId", "DELETE", token = token)

        if (status == 401) {
            _cloudVaultTokenExpired.value = true
            prefs.edit().putBoolean("cloudVault_tokenExpired", true).apply()
            return
        }
        vaultCredentialMap.remove(localId)
        saveVaultCredentialMap()
    }

    private fun syncPendingCredentials() {
        if (!_cloudVaultEnabled.value || vaultToken == null || _cloudVaultTokenExpired.value) return
        if (vaultTokenIssuedAt > 0 && System.currentTimeMillis() - vaultTokenIssuedAt > SIX_DAYS_MS) {
            _cloudVaultTokenExpired.value = true
            prefs.edit().putBoolean("cloudVault_tokenExpired", true).apply()
            return
        }
        val pw = masterPassword ?: return
        for (cred in _credentials.value) {
            if (vaultCredentialMap.containsKey(cred.id)) continue
            try {
                val plainKey = CryptoService.decrypt(
                    prefs.getString("key_${cred.id}", null) ?: continue, pw,
                )
                syncAddToVault(cred.id, cred.providerId, cred.label, cred.authMethod.name.lowercase(), plainKey)
            } catch (_: Exception) {}
        }
    }

    private fun syncAllCredentialsToVault() {
        val pw = masterPassword ?: return
        for (cred in _credentials.value) {
            try {
                val plainKey = CryptoService.decrypt(
                    prefs.getString("key_${cred.id}", null) ?: continue, pw,
                )
                syncAddToVault(cred.id, cred.providerId, cred.label, cred.authMethod.name.lowercase(), plainKey)
            } catch (_: Exception) {}
        }
    }
}
