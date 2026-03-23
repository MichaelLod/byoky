package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.byoky.app.crypto.CryptoService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

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

    private val _bridgeStatus = MutableStateFlow(BridgeStatus.INACTIVE)
    val bridgeStatus: StateFlow<BridgeStatus> = _bridgeStatus.asStateFlow()

    private val _lockoutEndTime = MutableStateFlow<Long?>(null)
    val lockoutEndTime: StateFlow<Long?> = _lockoutEndTime.asStateFlow()

    private var masterPassword: String? = null
    private var backgroundTime: Long? = null

    private val autoLockTimeout = 300_000L // 5 minutes

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
        return UnlockResult.Success
    }

    fun lock() {
        masterPassword = null
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
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
    }

    fun removeCredential(credential: Credential) {
        prefs.edit().remove("key_${credential.id}").apply()
        _credentials.value = _credentials.value.filter { it.id != credential.id }
        saveCredentials()
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
        editor.apply()

        // Clear in-memory state
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _requestLogs.value = emptyList()
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
}
