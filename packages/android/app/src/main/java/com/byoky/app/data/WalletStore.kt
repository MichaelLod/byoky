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

    private val _status = MutableStateFlow(WalletStatus.UNINITIALIZED)
    val status: StateFlow<WalletStatus> = _status.asStateFlow()

    private val _credentials = MutableStateFlow<List<Credential>>(emptyList())
    val credentials: StateFlow<List<Credential>> = _credentials.asStateFlow()

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _bridgeStatus = MutableStateFlow(BridgeStatus.INACTIVE)
    val bridgeStatus: StateFlow<BridgeStatus> = _bridgeStatus.asStateFlow()

    private var masterPassword: String? = null

    init {
        _status.value = if (prefs.contains("password_hash")) WalletStatus.LOCKED else WalletStatus.UNINITIALIZED
    }

    val isUnlocked: Boolean get() = _status.value == WalletStatus.UNLOCKED

    // MARK: - Password

    fun createPassword(password: String) {
        val hash = CryptoService.hashPassword(password)
        prefs.edit().putString("password_hash", hash).apply()
        masterPassword = password
        _status.value = WalletStatus.UNLOCKED
    }

    fun unlock(password: String): Boolean {
        val hash = prefs.getString("password_hash", null) ?: return false
        if (!CryptoService.verifyPassword(password, hash)) return false
        masterPassword = password
        _status.value = WalletStatus.UNLOCKED
        loadCredentials()
        loadSessions()
        return true
    }

    fun lock() {
        masterPassword = null
        _credentials.value = emptyList()
        _sessions.value = emptyList()
        _status.value = WalletStatus.LOCKED
    }

    // MARK: - Credentials

    fun addCredential(providerId: String, label: String, apiKey: String) {
        val password = masterPassword ?: throw IllegalStateException("Wallet locked")
        val credential = Credential(providerId = providerId, label = label)
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

    // MARK: - Bridge

    fun setBridgeStatus(status: BridgeStatus) {
        _bridgeStatus.value = status
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
}
