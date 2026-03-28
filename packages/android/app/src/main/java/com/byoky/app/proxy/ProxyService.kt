package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.GiftedCredential
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.data.isGiftExpired
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ProxyService(private val wallet: WalletStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private sealed class CredentialSource {
        data class Own(val credential: Credential, val apiKey: String) : CredentialSource()
        data class Gift(val gc: GiftedCredential) : CredentialSource()
    }

    fun findAvailablePort(): Int {
        return try {
            ServerSocket().use { socket ->
                socket.reuseAddress = true
                socket.bind(InetSocketAddress("127.0.0.1", 0))
                socket.localPort
            }
        } catch (_: Exception) {
            0
        }
    }

    fun checkAvailable(): Boolean {
        return wallet.credentials.value.isNotEmpty() || wallet.giftedCredentials.value.isNotEmpty()
    }

    fun proxyRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")

        val url = "${provider.baseUrl}$path"
        val source = resolveCredentialSource(providerId)

        if (source is CredentialSource.Gift) {
            return proxyRequestViaGift(source.gc, url, providerId, method, headers, body)
        }

        val own = source as CredentialSource.Own

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }.toMutableMap()

        applyAuth(filteredHeaders, providerId, own.credential.authMethod, own.apiKey)

        val injectedBody = injectStreamUsageOptions(providerId, body)
        val finalBody = if (providerId == "anthropic" && own.credential.authMethod == AuthMethod.OAUTH && injectedBody != null) {
            injectClaudeCodeSystemPrompt(injectedBody)
        } else {
            injectedBody
        }

        val requestBody = when {
            finalBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                val contentType = filteredHeaders["content-type"] ?: "application/json"
                finalBody.toRequestBody(contentType.toMediaTypeOrNull())
            }
            else -> null
        }

        val request = Request.Builder()
            .url(url)
            .method(method.uppercase(), requestBody)
            .headers(filteredHeaders.toHeaders())
            .build()

        return client.newCall(request).execute()
    }

    fun proxyStreamingRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Flow<ByteArray> = callbackFlow {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")

        val url = "${provider.baseUrl}$path"
        val credSource = resolveCredentialSource(providerId)
        var giftWs: WebSocket? = null

        if (credSource is CredentialSource.Gift) {
            val gc = credSource.gc
            val requestId = UUID.randomUUID().toString()
            val filteredHeaders = headers.filterKeys {
                it.lowercase() !in setOf("host", "authorization", "x-api-key")
            }

            val wsReq = Request.Builder().url(gc.relayUrl).build()
            giftWs = client.newWebSocket(wsReq, object : WebSocketListener() {
                var authenticated = false
                var reqSent = false

                override fun onOpen(ws: WebSocket, resp: Response) {
                    ws.send(JSONObject().apply {
                        put("type", "relay:auth")
                        put("roomId", gc.giftId)
                        put("authToken", gc.authToken)
                        put("role", "recipient")
                    }.toString())
                }

                fun sendReq(ws: WebSocket) {
                    if (reqSent) return
                    reqSent = true
                    ws.send(JSONObject().apply {
                        put("type", "relay:request")
                        put("requestId", requestId)
                        put("providerId", providerId)
                        put("url", url)
                        put("method", method)
                        put("headers", JSONObject(filteredHeaders))
                        body?.let { put("body", String(it, Charsets.UTF_8)) }
                    }.toString())
                }

                override fun onMessage(ws: WebSocket, text: String) {
                    try {
                        val json = JSONObject(text)
                        when (json.optString("type")) {
                            "relay:auth:result" -> {
                                if (json.optBoolean("success")) {
                                    authenticated = true
                                    if (json.optBoolean("peerOnline", false)) sendReq(ws)
                                } else {
                                    close(Exception("Gift auth failed"))
                                }
                            }
                            "relay:peer:status" -> {
                                if (json.optBoolean("online") && authenticated && !reqSent) sendReq(ws)
                            }
                            "relay:response:chunk" -> {
                                if (json.optString("requestId") == requestId) {
                                    trySend(json.optString("chunk", "").toByteArray(Charsets.UTF_8))
                                }
                            }
                            "relay:response:done" -> {
                                if (json.optString("requestId") == requestId) {
                                    Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                                    close()
                                }
                            }
                            "relay:response:error" -> {
                                if (json.optString("requestId") == requestId) {
                                    val msg = json.optJSONObject("error")?.optString("message") ?: "Gift relay error"
                                    close(Exception(msg))
                                }
                            }
                            "relay:usage" -> {
                                if (json.optString("giftId") == gc.giftId) {
                                    wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                                }
                            }
                        }
                    } catch (_: Exception) {}
                }

                override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                    close(Exception("Gift relay failed: ${t.message}"))
                }
            })
        } else {
            val own = credSource as CredentialSource.Own

            val filteredHeaders = headers.filterKeys {
                it.lowercase() !in setOf("host", "authorization", "x-api-key")
            }.toMutableMap()

            applyAuth(filteredHeaders, providerId, own.credential.authMethod, own.apiKey)

            val injectedBody = injectStreamUsageOptions(providerId, body)
            val finalBody = if (providerId == "anthropic" && own.credential.authMethod == AuthMethod.OAUTH && injectedBody != null) {
                injectClaudeCodeSystemPrompt(injectedBody)
            } else {
                injectedBody
            }

            val requestBody = when {
                finalBody != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                    val contentType = filteredHeaders["content-type"] ?: "application/json"
                    finalBody.toRequestBody(contentType.toMediaTypeOrNull())
                }
                else -> null
            }

            val request = Request.Builder()
                .url(url)
                .method(method.uppercase(), requestBody)
                .headers(filteredHeaders.toHeaders())
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body

            try {
                if (responseBody != null) {
                    val source = responseBody.source()
                    val buffer = ByteArray(4096)
                    while (!source.exhausted()) {
                        val read = source.read(buffer)
                        if (read > 0) {
                            send(buffer.copyOf(read))
                        }
                    }
                }
                close()
            } catch (e: Exception) {
                close(e)
            } finally {
                responseBody?.close()
            }
        }

        awaitClose { giftWs?.close(1000, null) }
    }

    private fun resolveCredentialSource(providerId: String): CredentialSource {
        val prefs = wallet.giftPreferences.value
        val giftedCreds = wallet.giftedCredentials.value
        val ownCred = wallet.credentials.value.firstOrNull { it.providerId == providerId }

        val preferredGiftId = prefs[providerId]
        if (preferredGiftId != null) {
            val gc = giftedCreds.firstOrNull {
                it.giftId == preferredGiftId && it.providerId == providerId
                        && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
            }
            if (gc != null) return CredentialSource.Gift(gc)
        }

        if (ownCred != null) {
            val apiKey = wallet.decryptKey(ownCred)
            return CredentialSource.Own(ownCred, apiKey)
        }

        val gc = giftedCreds.firstOrNull {
            it.providerId == providerId && !isGiftExpired(it.expiresAt) && it.usedTokens < it.maxTokens
        }
        if (gc != null) return CredentialSource.Gift(gc)

        throw IllegalStateException("No credential for provider: $providerId")
    }

    private fun proxyRequestViaGift(
        gc: GiftedCredential,
        url: String,
        providerId: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val requestId = UUID.randomUUID().toString()
        val latch = CountDownLatch(1)
        var error: Exception? = null
        var responseCode = 0
        var responseMessage = ""
        val respHeaders = mutableMapOf<String, String>()
        val responseBody = StringBuilder()
        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }

        val wsReq = Request.Builder().url(gc.relayUrl).build()
        val ws = client.newWebSocket(wsReq, object : WebSocketListener() {
            var authenticated = false
            var reqSent = false

            override fun onOpen(ws: WebSocket, resp: Response) {
                ws.send(JSONObject().apply {
                    put("type", "relay:auth")
                    put("roomId", gc.giftId)
                    put("authToken", gc.authToken)
                    put("role", "recipient")
                }.toString())
            }

            fun sendReq(ws: WebSocket) {
                if (reqSent) return
                reqSent = true
                ws.send(JSONObject().apply {
                    put("type", "relay:request")
                    put("requestId", requestId)
                    put("providerId", providerId)
                    put("url", url)
                    put("method", method)
                    put("headers", JSONObject(filteredHeaders))
                    body?.let { put("body", String(it, Charsets.UTF_8)) }
                }.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "relay:auth:result" -> {
                            if (json.optBoolean("success")) {
                                authenticated = true
                                if (json.optBoolean("peerOnline", false)) {
                                    sendReq(ws)
                                }
                            } else {
                                error = Exception("Gift auth failed: ${json.optString("error")}")
                                latch.countDown()
                            }
                        }
                        "relay:peer:status" -> {
                            if (json.optBoolean("online") && authenticated && !reqSent) {
                                sendReq(ws)
                            }
                        }
                        "relay:response:meta" -> {
                            if (json.optString("requestId") == requestId) {
                                responseCode = json.optInt("status")
                                responseMessage = json.optString("statusText", "")
                                val hdrs = json.optJSONObject("headers")
                                hdrs?.keys()?.forEach { k -> respHeaders[k] = hdrs.getString(k) }
                            }
                        }
                        "relay:response:chunk" -> {
                            if (json.optString("requestId") == requestId) {
                                responseBody.append(json.optString("chunk", ""))
                            }
                        }
                        "relay:response:done" -> {
                            if (json.optString("requestId") == requestId) {
                                latch.countDown()
                                Thread { Thread.sleep(2000); ws.close(1000, null) }.start()
                            }
                        }
                        "relay:response:error" -> {
                            if (json.optString("requestId") == requestId) {
                                val errObj = json.optJSONObject("error")
                                error = Exception(errObj?.optString("message") ?: "Gift relay error")
                                latch.countDown()
                            }
                        }
                        "relay:usage" -> {
                            if (json.optString("giftId") == gc.giftId) {
                                wallet.updateGiftedCredentialUsage(gc.giftId, json.optInt("usedTokens"))
                            }
                        }
                    }
                } catch (_: Exception) {}
            }

            override fun onFailure(ws: WebSocket, t: Throwable, resp: Response?) {
                error = Exception("Gift relay failed: ${t.message}")
                latch.countDown()
            }
        })

        if (!latch.await(150, TimeUnit.SECONDS)) {
            ws.close(1000, null)
            throw Exception("Gift relay request timed out")
        }

        error?.let { throw it }

        return Response.Builder()
            .code(responseCode)
            .message(responseMessage)
            .request(Request.Builder().url(url).build())
            .protocol(okhttp3.Protocol.HTTP_1_1)
            .body(responseBody.toString().toResponseBody("application/json".toMediaTypeOrNull()))
            .headers(okhttp3.Headers.Builder().apply {
                respHeaders.forEach { (k, v) -> add(k, v) }
            }.build())
            .build()
    }

    private fun injectStreamUsageOptions(providerId: String, body: ByteArray?): ByteArray? {
        if (body == null || providerId !in STREAM_USAGE_PROVIDERS) return body
        return try {
            val parsed = JSONObject(String(body, Charsets.UTF_8))
            if (parsed.optBoolean("stream", false)) {
                val streamOptions = parsed.optJSONObject("stream_options") ?: JSONObject()
                if (!streamOptions.optBoolean("include_usage", false)) {
                    streamOptions.put("include_usage", true)
                    parsed.put("stream_options", streamOptions)
                    parsed.toString().toByteArray(Charsets.UTF_8)
                } else body
            } else body
        } catch (_: Exception) { body }
    }

    private fun injectClaudeCodeSystemPrompt(body: ByteArray): ByteArray {
        return try {
            val parsed = org.json.JSONObject(String(body, Charsets.UTF_8))
            val prefix = "You are Claude Code, Anthropic's official CLI for Claude."
            val existing = parsed.optString("system", "").takeIf { it.isNotEmpty() }
            if (existing == null) {
                parsed.put("system", prefix)
            } else {
                parsed.put("system", "$prefix\n\n$existing")
            }
            parsed.toString().toByteArray(Charsets.UTF_8)
        } catch (_: Exception) {
            body
        }
    }

    private fun applyAuth(
        headers: MutableMap<String, String>,
        providerId: String,
        authMethod: AuthMethod,
        apiKey: String,
    ) {
        if (providerId == "anthropic" && authMethod == AuthMethod.OAUTH) {
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

    companion object {
        private val STREAM_USAGE_PROVIDERS = setOf("openai", "azure-openai", "together", "deepseek")
        val SENSITIVE_RESPONSE_HEADERS = setOf(
            "server", "x-request-id", "x-cloud-trace-context",
            "set-cookie", "set-cookie2", "alt-svc", "via",
        )
    }
}
