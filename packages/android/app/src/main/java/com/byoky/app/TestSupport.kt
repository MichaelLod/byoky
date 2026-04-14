package com.byoky.app

import android.content.Context
import android.os.Bundle
import android.util.Log
import com.byoky.app.data.WalletStatus
import com.byoky.app.data.WalletStore
import com.byoky.app.data.AuthMethod
import com.byoky.app.proxy.ProxyService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import okhttp3.Headers

/**
 * Test-only auto-setup hook. Mirrors iOS `ByokyApp.autoSetupIfNeeded`.
 * Driven by Intent extras passed when the UI-test launches MainActivity:
 *   - byoky_test_config_json: full config payload (matches iOS schema —
 *     `password`, `geminiKey`, `anthropicKey`, `openaiKey`, `fireAfterSetup`).
 *
 * All test-side I/O is emitted via Log.i("BYOKY_TEST", "<KEY>=<value>")
 * so the orchestrator's `adb logcat -s BYOKY_TEST` watcher can parse it
 * line-by-line. We avoid filesystem coordination because /data/local/tmp
 * is not consistently readable by the app sandbox across Android
 * versions; logcat works everywhere.
 */
object TestSupport {
    private const val TAG = "BYOKY_TEST"

    fun autoSetupIfNeeded(context: Context, wallet: WalletStore, extras: Bundle?) {
        Log.i(TAG, "autoSetup_called extras_keys=${extras?.keySet()?.joinToString() ?: "null"} status=${wallet.status.value}")
        val configJson = extras?.getString("byoky_test_config_json") ?: return
        val config = try { JSONObject(configJson) } catch (e: Exception) {
            Log.w(TAG, "config_parse_error: ${e.message}")
            return
        }
        // Run all wallet ops off Main — createPassword's PBKDF2 + Keystore
        // calls and addCredential's encrypt path block Main long enough to
        // trip StrictMode and (silently) deadlock under instrumented test.
        // Mirrors the pattern used elsewhere in the app.
        val redeemLinkPath = config.optString("redeemLinkFile").takeIf { it.isNotEmpty() }
        CoroutineScope(Dispatchers.IO).launch {
            if (wallet.status.value == WalletStatus.UNINITIALIZED) {
                val password = config.optString("password", "UITestDefault1234!")
                try { wallet.createPassword(password) } catch (e: Exception) {
                    Log.w(TAG, "createPassword_failed: ${e.message}")
                    return@launch
                }
                Log.i(TAG, "createPassword_done")
                config.optString("geminiKey").takeIf { it.isNotEmpty() }?.let {
                    runCatching { wallet.addCredential("gemini", "Google Gemini", it, AuthMethod.API_KEY) }
                        .onFailure { Log.w(TAG, "addCredential_gemini_failed: ${it.message}") }
                }
                config.optString("anthropicKey").takeIf { it.isNotEmpty() }?.let {
                    runCatching { wallet.addCredential("anthropic", "Anthropic", it, AuthMethod.API_KEY) }
                        .onFailure { Log.w(TAG, "addCredential_anthropic_failed: ${it.message}") }
                }
                config.optString("openaiKey").takeIf { it.isNotEmpty() }?.let {
                    runCatching { wallet.addCredential("openai", "OpenAI", it, AuthMethod.API_KEY) }
                        .onFailure { Log.w(TAG, "addCredential_openai_failed: ${it.message}") }
                }
                Log.i(TAG, "auto_setup_done")
            }

            // Auto-redeem from a sentinel file before firing — UI-typing
            // a ~800-char URL via `input text` mangles the special chars
            // (#, /, =) and makes the link undecodable. Reading the file
            // directly + calling wallet.redeemGift bypasses the input layer.
            if (redeemLinkPath != null) {
                runCatching {
                    val link = java.io.File(redeemLinkPath).readText().trim()
                    val encoded = link.removePrefix("https://byoky.com/gift#")
                        .removePrefix("https://byoky.com/gift/")
                        .removePrefix("byoky://gift/")
                    wallet.redeemGift(encoded)
                    Log.i(TAG, "auto_redeem_done")
                }.onFailure { Log.w(TAG, "auto_redeem_failed: ${it.message}") }
            }

            val fireProvider = config.optString("fireAfterSetup").takeIf { it.isNotEmpty() }
            if (fireProvider != null) {
                fireTestRequestWhenGiftArrives(context, wallet, fireProvider)
            }
        }
    }

    /**
     * Reverse-flow helper: polls for a redeemed gift on `providerId`, then
     * issues a real API call via the gift relay using ProxyService.
     * Outputs a single-line JSON to logcat:
     *   BYOKY_TEST PROXY_RESULT={"success":true,"status":200,...}
     */
    private suspend fun fireTestRequestWhenGiftArrives(
        context: Context,
        wallet: WalletStore,
        providerId: String,
    ) {
        var attempts = 0
        while (attempts < 180) { // 90s
            val gc = wallet.giftedCredentials.value.firstOrNull { it.providerId == providerId }
            if (gc != null) break
            delay(500)
            attempts++
        }
        val gc = wallet.giftedCredentials.value.firstOrNull { it.providerId == providerId }
        if (gc == null) {
            emitResult(success = false, error = "No gifted credential for $providerId within 90s", providerId = providerId)
            return
        }

        val (path, method, headers, body) = buildTestRequest(providerId)
        if (path == null) {
            emitResult(success = false, error = "Unsupported provider for auto-fire: $providerId", providerId = providerId)
            return
        }

        val proxy = ProxyService(wallet, context)
        var lastError: String? = null
        for (attempt in 1..3) {
            try {
                val response = withContext(Dispatchers.IO) {
                    proxy.proxyRequest(providerId, path, method, headers, body)
                }
                val responseText = response.body?.string() ?: ""
                val ok = response.code in 200..399 && responseText.isNotEmpty()
                emitResult(
                    success = ok,
                    status = response.code,
                    providerId = providerId,
                    responseBytes = responseText.length,
                    responsePreview = responseText.take(400),
                    attempts = attempt,
                )
                return
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
                delay(2_500)
            }
        }
        emitResult(success = false, error = lastError ?: "unknown", providerId = providerId, attempts = 3)
    }

    private fun buildTestRequest(providerId: String): Quad {
        val jsonHeaders = mapOf("content-type" to "application/json")
        return when (providerId) {
            "anthropic" -> Quad(
                "/v1/messages",
                "POST",
                jsonHeaders + ("anthropic-version" to "2023-06-01"),
                "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}".toByteArray(),
            )
            "openai" -> Quad(
                "/v1/chat/completions",
                "POST",
                jsonHeaders,
                "{\"model\":\"gpt-4o-mini\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}".toByteArray(),
            )
            "gemini" -> Quad(
                "/v1beta/models/gemini-2.0-flash:generateContent",
                "POST",
                jsonHeaders,
                "{\"contents\":[{\"parts\":[{\"text\":\"Say hi in one word.\"}]}]}".toByteArray(),
            )
            else -> Quad(null, "POST", emptyMap(), null)
        }
    }

    private data class Quad(
        val path: String?,
        val method: String,
        val headers: Map<String, String>,
        val body: ByteArray?,
    )

    private fun emitResult(
        success: Boolean,
        status: Int = 0,
        providerId: String,
        responseBytes: Int = 0,
        responsePreview: String = "",
        error: String? = null,
        attempts: Int = 1,
    ) {
        val obj = JSONObject().apply {
            put("success", success)
            put("status", status)
            put("providerId", providerId)
            put("responseBytes", responseBytes)
            put("response", responsePreview)
            put("attempts", attempts)
            if (error != null) put("error", error)
        }
        Log.i(TAG, "PROXY_RESULT=${obj}")
    }
}
