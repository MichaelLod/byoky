package com.byoky.app.relay

import com.byoky.app.data.Gift
import com.byoky.app.data.Provider
import com.byoky.app.data.UsageParser
import com.byoky.app.data.WalletStore
import com.byoky.app.data.WalletStatus
import com.byoky.app.data.isGiftExpired
import com.byoky.app.proxy.ProxyService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Maintains persistent `role: "sender"` WebSocket connections to each active
 * gift's relay, so gifts created on Android are actually reachable by
 * recipients. Mirrors the browser extension's `connectGiftRelay`
 * (`packages/extension/entrypoints/background.ts`).
 */
object GiftRelayHost {

    private val connections = ConcurrentHashMap<String, GiftRelayConnection>()
    private var wallet: WalletStore? = null

    fun attach(wallet: WalletStore) {
        this.wallet = wallet
    }

    fun connect(gift: Gift) {
        val w = wallet ?: return
        if (connections.containsKey(gift.id)) return
        if (!gift.active || isGiftExpired(gift.expiresAt)) return

        val conn = GiftRelayConnection(gift, w, this)
        connections[gift.id] = conn
        conn.start()
    }

    fun disconnect(giftId: String) {
        connections.remove(giftId)?.close(reconnect = false)
    }

    fun disconnectAll() {
        val snapshot = connections.toMap()
        connections.clear()
        snapshot.values.forEach { it.close(reconnect = false) }
    }

    fun reconnectAll() {
        val w = wallet ?: return
        if (w.status.value != WalletStatus.UNLOCKED) return
        for (gift in w.gifts.value) {
            if (gift.active && !isGiftExpired(gift.expiresAt)) {
                connect(gift)
            }
        }
    }

    internal fun forget(giftId: String) {
        connections.remove(giftId)
    }

    internal fun currentGift(id: String): Gift? {
        return wallet?.gifts?.value?.firstOrNull {
            it.id == id && it.active && !isGiftExpired(it.expiresAt)
        }
    }
}

private class GiftRelayConnection(
    gift: Gift,
    private val wallet: WalletStore,
    private val host: GiftRelayHost,
) {
    private val giftId = gift.id
    private val relayUrl = gift.relayUrl
    private val authToken = gift.authToken

    private val scope = CoroutineScope(Dispatchers.IO)
    private val budgetMutex = Mutex()

    private val wsClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(120, TimeUnit.SECONDS)
        .build()

    private val proxyClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    @Volatile
    private var ws: WebSocket? = null
    @Volatile
    private var closed = false
    private var reconnectJob: Job? = null

    fun start() {
        if (!relayUrl.startsWith("wss://")) return

        closed = false
        val request = Request.Builder().url(relayUrl).build()
        ws = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val auth = JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", giftId)
                    put("authToken", authToken)
                    put("role", "sender")
                    put("priority", 1)
                }
                ws.send(auth.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "relay:auth:result" -> {
                            if (json.optBoolean("success", false).not()) {
                                host.forget(giftId)
                                close(reconnect = false)
                            }
                        }
                        "relay:request" -> {
                            scope.launch {
                                budgetMutex.withLock {
                                    handleRelayRequest(json)
                                }
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (!closed) {
                    host.forget(giftId)
                    close(reconnect = true)
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (!closed) {
                    host.forget(giftId)
                    close(reconnect = true)
                }
            }
        })
    }

    fun close(reconnect: Boolean) {
        if (closed) return
        closed = true
        reconnectJob?.cancel()
        reconnectJob = null
        try { ws?.close(1000, null) } catch (_: Exception) {}
        ws = null

        if (reconnect) {
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        reconnectJob = scope.launch {
            delay(5_000)
            val gift = host.currentGift(giftId) ?: return@launch
            if (wallet.status.value != WalletStatus.UNLOCKED) return@launch
            host.connect(gift)
        }
    }

    private fun handleRelayRequest(json: JSONObject) {
        val requestId = json.optString("requestId").takeIf { it.isNotEmpty() } ?: return
        val urlString = json.optString("url").takeIf { it.isNotEmpty() } ?: return
        val method = json.optString("method").takeIf { it.isNotEmpty() } ?: return

        if (wallet.status.value != WalletStatus.UNLOCKED) {
            sendError(requestId, "WALLET_LOCKED", "Sender wallet is locked")
            return
        }

        val gift = wallet.gifts.value.firstOrNull { it.id == giftId }
        if (gift == null || !gift.active || isGiftExpired(gift.expiresAt)) {
            sendError(requestId, "GIFT_EXPIRED", "Gift has expired or been revoked")
            return
        }
        if (gift.usedTokens >= gift.maxTokens) {
            sendError(requestId, "GIFT_BUDGET_EXHAUSTED", "Gift token budget exhausted")
            return
        }

        val credential = wallet.credentials.value.firstOrNull { it.id == gift.credentialId }
        if (credential == null) {
            sendError(requestId, "PROVIDER_UNAVAILABLE", "Credential no longer available")
            return
        }

        // Use the gift's provider for everything downstream — the request
        // message's providerId is the *source* in a cross-family translated
        // call and would mis-route URL validation, auth, usage parsing.
        // Mirrors background.ts handleGiftProxyRequest which uses
        // `gift.providerId` throughout.
        val providerId = gift.providerId
        val provider = Provider.find(providerId)
        if (provider == null) {
            sendError(requestId, "INVALID_URL", "Unknown provider")
            return
        }

        val reqUrl = try { java.net.URL(urlString) } catch (_: Exception) { null }
        val requestHost = reqUrl?.host
        val isLocalProvider = providerId == "ollama" || providerId == "lm_studio"
        val isLoopbackHost = requestHost == "localhost" || requestHost == "127.0.0.1" || requestHost == "::1"
        val schemeOk = reqUrl?.protocol == "https" || (reqUrl?.protocol == "http" && isLocalProvider && isLoopbackHost)
        val hostOk = when {
            !schemeOk -> false
            providerId == "azure_openai" -> requestHost?.endsWith(".openai.azure.com") == true
            isLocalProvider -> {
                // Local providers validate against the gifter's stored
                // credential baseUrl (host + port). The default provider
                // placeholder would reject any real user's endpoint.
                val credUrl = credential.baseUrl?.let { try { java.net.URL(it) } catch (_: Exception) { null } }
                credUrl != null
                    && requestHost == credUrl.host
                    && reqUrl.port == credUrl.port
            }
            else -> requestHost == try { java.net.URL(provider.baseUrl).host } catch (_: Exception) { null }
        }
        if (!hostOk) {
            sendError(requestId, "INVALID_URL", "Request URL does not match provider")
            return
        }

        val apiKey: String
        try {
            apiKey = wallet.decryptKey(credential)
        } catch (_: Exception) {
            sendError(requestId, "PROXY_ERROR", "Failed to decrypt credential")
            return
        }

        val headers = mutableMapOf<String, String>()
        val headersObj = json.optJSONObject("headers")
        headersObj?.keys()?.forEach { key ->
            headers[key] = headersObj.getString(key)
        }
        val bodyString = json.optString("body", "").takeIf { it.isNotEmpty() }

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }.toMutableMap()

        applyAuth(filteredHeaders, providerId, credential.authMethod, apiKey)

        val injectedBody = injectStreamUsageOptions(providerId, bodyString)

        val requestBody = if (injectedBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
            val contentType = filteredHeaders["content-type"] ?: "application/json"
            injectedBody.toByteArray(Charsets.UTF_8)
                .toRequestBody(contentType.toMediaTypeOrNull())
        } else null

        val upstreamRequest = Request.Builder()
            .url(urlString)
            .method(method.uppercase(), requestBody)
            .apply {
                filteredHeaders.forEach { (k, v) -> addHeader(k, v) }
            }
            .build()

        try {
            val response = proxyClient.newCall(upstreamRequest).execute()

            val responseHeaders = JSONObject()
            response.headers.forEach { (name, value) ->
                if (name.lowercase() !in ProxyService.SENSITIVE_RESPONSE_HEADERS) {
                    responseHeaders.put(name.lowercase(), value)
                }
            }

            sendJSON(JSONObject().apply {
                put("type", "relay:response:meta")
                put("requestId", requestId)
                put("status", response.code)
                put("statusText", response.message)
                put("headers", responseHeaders)
            })

            val body = response.body
            val fullResponse = StringBuilder()
            if (body != null) {
                val source = body.source()
                val buffer = StringBuilder()
                while (!source.exhausted()) {
                    val byte = source.readByte()
                    val char = byte.toInt().toChar()
                    buffer.append(char)
                    fullResponse.append(char)
                    if (buffer.length >= 4096 || char == '\n') {
                        sendJSON(JSONObject().apply {
                            put("type", "relay:response:chunk")
                            put("requestId", requestId)
                            put("chunk", buffer.toString())
                        })
                        buffer.clear()
                    }
                }
                if (buffer.isNotEmpty()) {
                    sendJSON(JSONObject().apply {
                        put("type", "relay:response:chunk")
                        put("requestId", requestId)
                        put("chunk", buffer.toString())
                    })
                }
                body.close()
            }

            sendJSON(JSONObject().apply {
                put("type", "relay:response:done")
                put("requestId", requestId)
            })

            val usage = UsageParser.parseUsage(providerId, fullResponse.toString())
            if (usage != null) {
                val total = usage.inputTokens + usage.outputTokens
                if (total > 0) {
                    val newUsed = wallet.addGiftSenderUsage(giftId, total)
                    if (newUsed != null) {
                        sendJSON(JSONObject().apply {
                            put("type", "relay:usage")
                            put("giftId", giftId)
                            put("usedTokens", newUsed)
                        })
                    }
                }
            }

            wallet.logRequest(
                appOrigin = "gift",
                providerId = providerId,
                method = method,
                url = urlString,
                statusCode = response.code,
                requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                responseBody = fullResponse.toString(),
            )
        } catch (_: Exception) {
            sendError(requestId, "PROXY_ERROR", "Request failed")
        }
    }

    private fun applyAuth(
        headers: MutableMap<String, String>,
        providerId: String,
        authMethod: com.byoky.app.data.AuthMethod,
        apiKey: String,
    ) {
        if (providerId == "azure_openai") {
            headers["api-key"] = apiKey
            return
        }
        if (providerId == "gemini") {
            headers["x-goog-api-key"] = apiKey
            return
        }
        if (providerId == "ollama" || providerId == "lm_studio") {
            if (apiKey.isNotEmpty()) {
                headers["Authorization"] = "Bearer $apiKey"
            }
            return
        }
        if (providerId == "anthropic" && authMethod == com.byoky.app.data.AuthMethod.OAUTH) {
            headers["Authorization"] = "Bearer $apiKey"
            headers["User-Agent"] = "claude-cli/2.1.76"
            headers["x-app"] = "cli"
            if (!headers.containsKey("Accept") && !headers.containsKey("accept")) {
                headers["Accept"] = "application/json"
            }
            val oauthBeta = listOf(
                "claude-code-20250219",
                "oauth-2025-04-20",
                "fine-grained-tool-streaming-2025-05-14",
                "interleaved-thinking-2025-05-14",
            )
            val existing = (headers["anthropic-beta"] ?: "")
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            val merged = (existing + oauthBeta).distinct().sorted()
            headers["anthropic-beta"] = merged.joinToString(",")
            headers["anthropic-dangerous-direct-browser-access"] = "true"
        } else if (providerId == "anthropic") {
            headers["x-api-key"] = apiKey
        } else {
            headers["Authorization"] = "Bearer $apiKey"
        }
    }

    private fun injectStreamUsageOptions(providerId: String, body: String?): String? {
        if (body == null || providerId !in STREAM_USAGE_PROVIDERS) return body
        return try {
            val parsed = JSONObject(body)
            if (parsed.optBoolean("stream", false)) {
                val streamOptions = parsed.optJSONObject("stream_options") ?: JSONObject()
                if (!streamOptions.optBoolean("include_usage", false)) {
                    streamOptions.put("include_usage", true)
                    parsed.put("stream_options", streamOptions)
                    parsed.toString()
                } else body
            } else body
        } catch (_: Exception) { body }
    }

    private fun sendError(requestId: String, code: String, message: String) {
        sendJSON(JSONObject().apply {
            put("type", "relay:response:error")
            put("requestId", requestId)
            put("error", JSONObject().apply {
                put("code", code)
                put("message", message)
            })
        })
    }

    private fun sendJSON(obj: JSONObject) {
        ws?.send(obj.toString())
    }

    companion object {
        private val STREAM_USAGE_PROVIDERS = setOf("openai", "azure_openai", "together", "deepseek")
    }
}
