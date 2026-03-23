package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.TimeUnit

class ProxyService(private val wallet: WalletStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

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

    fun proxyRequest(
        providerId: String,
        path: String,
        method: String,
        headers: Map<String, String>,
        body: ByteArray?,
    ): Response {
        val provider = Provider.find(providerId)
            ?: throw IllegalArgumentException("Unknown provider: $providerId")

        val credential = wallet.credentials.value.firstOrNull { it.providerId == providerId }
            ?: throw IllegalStateException("No credential for provider: $providerId")

        val apiKey = wallet.decryptKey(credential)

        val url = "${provider.baseUrl}$path"

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }.toMutableMap()

        applyAuth(filteredHeaders, providerId, credential.authMethod, apiKey)

        val requestBody = when {
            body != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                val contentType = filteredHeaders["content-type"] ?: "application/json"
                body.toRequestBody(contentType.toMediaTypeOrNull())
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

        val credential = wallet.credentials.value.firstOrNull { it.providerId == providerId }
            ?: throw IllegalStateException("No credential for provider: $providerId")

        val apiKey = wallet.decryptKey(credential)

        val url = "${provider.baseUrl}$path"

        val filteredHeaders = headers.filterKeys {
            it.lowercase() !in setOf("host", "authorization", "x-api-key")
        }.toMutableMap()

        applyAuth(filteredHeaders, providerId, credential.authMethod, apiKey)

        val requestBody = when {
            body != null && method.uppercase() in setOf("POST", "PUT", "PATCH") -> {
                val contentType = filteredHeaders["content-type"] ?: "application/json"
                body.toRequestBody(contentType.toMediaTypeOrNull())
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

        awaitClose()
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
}
