package com.byoky.app.relay

import android.util.Base64
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

enum class PairStatus {
    IDLE, CONNECTING, PAIRED, ERROR;

    var appOrigin: String? = null
    var errorMessage: String? = null
}

data class PairPayload(
    val relayUrl: String,
    val roomId: String,
    val authToken: String,
    val appOrigin: String,
) {
    companion object {
        fun decode(encoded: String): PairPayload? {
            return try {
                val base64 = encoded
                    .replace("-", "+")
                    .replace("_", "/")
                    .let {
                        val remainder = it.length % 4
                        if (remainder > 0) it + "=".repeat(4 - remainder) else it
                    }
                val data = Base64.decode(base64, Base64.DEFAULT)
                val json = JSONObject(String(data, Charsets.UTF_8))
                if (json.optInt("v") != 1) return null
                PairPayload(
                    relayUrl = json.getString("r"),
                    roomId = json.getString("id"),
                    authToken = json.getString("t"),
                    appOrigin = json.getString("o"),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}

class RelayPairService {
    private val _status = MutableStateFlow(PairStatus.IDLE)
    val status: StateFlow<PairStatus> = _status.asStateFlow()

    private val _requestCount = MutableStateFlow(0)
    val requestCount: StateFlow<Int> = _requestCount.asStateFlow()

    private var webSocket: WebSocket? = null
    private var wallet: WalletStore? = null
    private var pairedOrigin: String? = null
    private var lastPayload: PairPayload? = null
    private val scope = CoroutineScope(Dispatchers.IO)

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private val proxyClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    fun connect(payload: PairPayload, wallet: WalletStore) {
        this.wallet = wallet
        this.lastPayload = payload
        _status.value = PairStatus.CONNECTING

        if (!payload.relayUrl.startsWith("wss://")) {
            _status.value = PairStatus.ERROR.also { it.errorMessage = "Relay must use a secure connection (wss://)" }
            return
        }

        val request = Request.Builder().url(payload.relayUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                val auth = JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", payload.roomId)
                    put("authToken", payload.authToken)
                    put("role", "sender")
                }
                ws.send(auth.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    handleMessage(type, json, payload)
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                if (_status.value == PairStatus.PAIRED) {
                    _status.value = PairStatus.ERROR.also { it.errorMessage = "Connection lost" }
                }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                if (_status.value == PairStatus.PAIRED) {
                    _status.value = PairStatus.ERROR.also { it.errorMessage = "Connection closed" }
                }
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, null)
        webSocket = null
        pairedOrigin = null
        lastPayload = null
        _status.value = PairStatus.IDLE
        _requestCount.value = 0
    }

    fun reconnectIfNeeded() {
        val payload = lastPayload ?: return
        val wallet = wallet ?: return
        when (_status.value) {
            PairStatus.PAIRED -> connect(payload, wallet)
            PairStatus.ERROR -> connect(payload, wallet)
            else -> {}
        }
    }

    private fun handleMessage(type: String, json: JSONObject, payload: PairPayload) {
        when (type) {
            "relay:auth:result" -> {
                if (json.optBoolean("success")) {
                    sendPairHello()
                } else {
                    val error = json.optString("error", "Auth failed")
                    _status.value = PairStatus.ERROR.also { it.errorMessage = error }
                }
            }
            "relay:pair:ack" -> {
                pairedOrigin = payload.appOrigin
                _status.value = PairStatus.PAIRED.also { it.appOrigin = payload.appOrigin }
            }
            "relay:request" -> handleRelayRequest(json)
            "relay:peer:status" -> {
                if (!json.optBoolean("online", true) && _status.value == PairStatus.PAIRED) {
                    pairedOrigin = null
                    _status.value = PairStatus.IDLE
                    _requestCount.value = 0
                }
            }
        }
    }

    private fun sendPairHello() {
        val wallet = wallet ?: return
        val providers = JSONObject()
        for (credential in wallet.credentials.value) {
            providers.put(credential.providerId, JSONObject().apply {
                put("available", true)
                put("authMethod", if (credential.authMethod == com.byoky.app.data.AuthMethod.API_KEY) "api_key" else "oauth")
            })
        }
        sendJSON(JSONObject().apply {
            put("type", "relay:pair:hello")
            put("providers", providers)
        })
    }

    private fun handleRelayRequest(json: JSONObject) {
        if (_status.value != PairStatus.PAIRED) return

        val wallet = this.wallet ?: return
        val requestId = json.optString("requestId") ?: return
        val providerId = json.optString("providerId") ?: return
        val urlString = json.optString("url") ?: return
        val method = json.optString("method") ?: return

        val origin = pairedOrigin ?: "relay"
        val allowanceCheck = wallet.checkAllowance(origin, providerId)
        if (!allowanceCheck.allowed) {
            sendRelayError(requestId, "QUOTA_EXCEEDED", allowanceCheck.reason ?: "Token allowance exceeded")
            return
        }

        val provider = Provider.find(providerId)
        if (provider == null) {
            sendRelayError(requestId, "NO_PROVIDER", "Unknown provider: $providerId")
            return
        }

        // Validate URL matches provider
        val providerHost = java.net.URL(provider.baseUrl).host
        val requestHost = try { java.net.URL(urlString).host } catch (_: Exception) { null }
        if (requestHost != providerHost) {
            sendRelayError(requestId, "INVALID_URL", "URL doesn't match provider")
            return
        }

        val headers = mutableMapOf<String, String>()
        val headersObj = json.optJSONObject("headers")
        headersObj?.keys()?.forEach { key ->
            headers[key] = headersObj.getString(key)
        }
        val bodyString = json.optString("body", "").takeIf { it.isNotEmpty() }

        scope.launch {
            _requestCount.value++
            try {
                val credential = wallet.credentials.value.firstOrNull { it.providerId == providerId }
                if (credential == null) {
                    sendRelayError(requestId, "NO_CREDENTIAL", "No credential for $providerId")
                    return@launch
                }

                val apiKey = wallet.decryptKey(credential)

                val filteredHeaders = headers.filterKeys {
                    it.lowercase() !in setOf("host", "authorization", "x-api-key")
                }.toMutableMap()

                // Apply auth
                applyAuth(filteredHeaders, providerId, credential.authMethod, apiKey, bodyString)

                // Setup tokens require the Claude Code system prompt
                val finalBody = if (providerId == "anthropic" && credential.authMethod == com.byoky.app.data.AuthMethod.OAUTH && bodyString != null) {
                    try {
                        val parsed = JSONObject(bodyString)
                        val prefix = "You are Claude Code, Anthropic's official CLI for Claude."
                        val existing = parsed.optString("system", "").takeIf { it.isNotEmpty() }
                        if (existing == null) parsed.put("system", prefix)
                        else parsed.put("system", "$prefix\n\n$existing")
                        parsed.toString()
                    } catch (_: Exception) { bodyString }
                } else {
                    bodyString
                }

                val requestBody = if (finalBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH")) {
                    val contentType = filteredHeaders["content-type"] ?: "application/json"
                    finalBody.toByteArray(Charsets.UTF_8)
                        .toRequestBody(contentType.toMediaTypeOrNull())
                } else null

                val request = Request.Builder()
                    .url(urlString)
                    .method(method.uppercase(), requestBody)
                    .apply {
                        filteredHeaders.forEach { (k, v) ->
                            addHeader(k, v)
                        }
                    }
                    .build()

                val response = proxyClient.newCall(request).execute()

                // Send response meta
                val responseHeaders = JSONObject()
                response.headers.forEach { (name, value) ->
                    responseHeaders.put(name.lowercase(), value)
                }

                sendJSON(JSONObject().apply {
                    put("type", "relay:response:meta")
                    put("requestId", requestId)
                    put("status", response.code)
                    put("statusText", response.message)
                    put("headers", responseHeaders)
                })

                // Stream response body in chunks
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

                // Log request
                val origin = pairedOrigin ?: "relay"
                wallet.logRequest(
                    appOrigin = origin,
                    providerId = providerId,
                    method = method,
                    url = urlString,
                    statusCode = response.code,
                    requestBody = bodyString?.toByteArray(Charsets.UTF_8),
                    responseBody = fullResponse.toString(),
                )
            } catch (e: Exception) {
                sendRelayError(requestId, "PROXY_ERROR", e.message ?: "Unknown error")
            }
        }
    }

    private fun applyAuth(
        headers: MutableMap<String, String>,
        providerId: String,
        authMethod: com.byoky.app.data.AuthMethod,
        apiKey: String,
        bodyString: String?,
    ) {
        if (providerId == "anthropic" && authMethod == com.byoky.app.data.AuthMethod.OAUTH) {
            headers["Authorization"] = "Bearer $apiKey"
            headers["User-Agent"] = "claude-cli/2.1.76"
            headers["x-app"] = "cli"
            if (!headers.containsKey("Accept") && !headers.containsKey("accept")) {
                headers["Accept"] = "application/json"
            }
            // Merge beta flags
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

    private fun sendRelayError(requestId: String, code: String, message: String) {
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
        webSocket?.send(obj.toString())
    }
}
