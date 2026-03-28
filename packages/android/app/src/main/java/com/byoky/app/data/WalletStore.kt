package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.byoky.app.crypto.CryptoService
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

    private val _tokenAllowances = MutableStateFlow<List<TokenAllowance>>(emptyList())
    val tokenAllowances: StateFlow<List<TokenAllowance>> = _tokenAllowances.asStateFlow()

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
        loadSessions()
        loadRequestLogs()
        loadGifts()
        loadGiftedCredentials()
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
        _tokenAllowances.value = emptyList()
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
        _giftedCredentials.value = _giftedCredentials.value.filter { it.id != id }
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
    ) {
        var sanitizedUrl = url
        val queryIndex = url.indexOf('?')
        if (queryIndex >= 0) sanitizedUrl = url.substring(0, queryIndex)

        val model = UsageParser.parseModel(requestBody)
        var inputTokens: Int? = null
        var outputTokens: Int? = null

        if (responseBody != null) {
            val usage = UsageParser.parseUsage(providerId, responseBody)
            inputTokens = usage?.inputTokens
            outputTokens = usage?.outputTokens
        }

        val entry = RequestLog(
            appOrigin = appOrigin,
            providerId = providerId,
            method = method,
            url = sanitizedUrl,
            statusCode = statusCode,
            model = model,
            inputTokens = inputTokens,
            outputTokens = outputTokens,
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
