package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import okhttp3.Headers.Companion.toHeaders
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ProxyService(private val wallet: WalletStore) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

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

        // Provider-specific auth
        if (providerId == "anthropic" && credential.authMethod == AuthMethod.OAUTH) {
            filteredHeaders["Authorization"] = "Bearer $apiKey"
            filteredHeaders["User-Agent"] = "claude-cli/2.1.76"
            filteredHeaders["x-app"] = "cli"
            if (!filteredHeaders.containsKey("Accept") && !filteredHeaders.containsKey("accept")) {
                filteredHeaders["Accept"] = "application/json"
            }
            // Merge beta flags
            val oauthBeta = listOf(
                "claude-code-20250219",
                "oauth-2025-04-20",
                "fine-grained-tool-streaming-2025-05-14",
                "interleaved-thinking-2025-05-14",
            )
            val existing = (filteredHeaders["anthropic-beta"] ?: "")
                .split(",")
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            val merged = (existing + oauthBeta).distinct().sorted()
            filteredHeaders["anthropic-beta"] = merged.joinToString(",")
            filteredHeaders["anthropic-dangerous-direct-browser-access"] = "true"
        } else if (providerId == "anthropic") {
            filteredHeaders["x-api-key"] = apiKey
        } else {
            filteredHeaders["Authorization"] = "Bearer $apiKey"
        }

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
}
