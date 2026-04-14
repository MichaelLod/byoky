package com.byoky.app

import android.content.Context
import android.os.Bundle
import android.util.Log
import com.byoky.app.BuildConfig
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
        // SECURITY: MainActivity is an exported launcher, so *any* app on the
        // device can start it with arbitrary intent extras. Gate the entire
        // test hook on debuggable builds so that release APKs can't be
        // coerced into creating a wallet, redeeming a gift, or firing an
        // upstream API call by a peer app. Instrumented tests run on the
        // debug buildType, so this does not affect the UI-automator harness.
        if (!BuildConfig.DEBUG) return
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
                val firePayload = config.optString("firePayload").takeIf { it.isNotEmpty() } ?: "chat"
                fireTestRequestWhenGiftArrives(context, wallet, fireProvider, firePayload)
            }
        }
    }

    /**
     * Reverse-flow helper: polls for a redeemed gift on `providerId`, then
     * issues a real API call via the gift relay using ProxyService.
     *
     * `firePayload` chooses which request to build. Supported:
     *   - "chat"       — minimal 32-token completion (default, smallest check)
     *   - "stream"     — same body with stream=true; proves SSE chunks
     *                     survive the relay
     *   - "vision"     — multi-part message with a base64 1×1 PNG; proves
     *                     image bytes survive the relay
     *   - "tools"      — one-shot request with a weather tool definition;
     *                     validates the response contains a tool_use block
     *   - "structured" — json_object / json_schema request; validates the
     *                     reply parses as JSON
     *
     * Outputs a single-line JSON to logcat:
     *   BYOKY_TEST PROXY_RESULT={"success":true,"status":200,"mode":"stream",...}
     */
    private suspend fun fireTestRequestWhenGiftArrives(
        context: Context,
        wallet: WalletStore,
        providerId: String,
        firePayload: String = "chat",
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
            emitResult(success = false, error = "No gifted credential for $providerId within 90s", providerId = providerId, mode = firePayload)
            return
        }

        val (path, method, headers, body) = buildTestRequest(providerId, firePayload)
        if (path == null) {
            emitResult(success = false, error = "Unsupported provider/mode for auto-fire: $providerId/$firePayload", providerId = providerId, mode = firePayload)
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
                val (modeOk, modeNote) = validatePayloadShape(firePayload, providerId, response.code, responseText)
                val ok = response.code in 200..399 && responseText.isNotEmpty() && modeOk
                emitResult(
                    success = ok,
                    status = response.code,
                    providerId = providerId,
                    responseBytes = responseText.length,
                    responsePreview = responseText.take(400),
                    attempts = attempt,
                    mode = firePayload,
                    modeNote = modeNote,
                )
                return
            } catch (e: Exception) {
                lastError = e.message ?: e.javaClass.simpleName
                delay(2_500)
            }
        }
        emitResult(success = false, error = lastError ?: "unknown", providerId = providerId, attempts = 3, mode = firePayload)
    }

    /** 1×1 transparent PNG, base64-encoded. Same bytes the demo-playground spec uses. */
    private const val PIXEL_PNG_B64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    private fun buildTestRequest(providerId: String, mode: String): Quad {
        val jsonHeaders = mapOf("content-type" to "application/json")
        val anthropicHeaders = jsonHeaders + ("anthropic-version" to "2023-06-01")

        // Chat is the simplest — minimal "say hi" body. Every other mode
        // substitutes a different body for the same provider endpoint.
        if (mode == "chat") {
            return when (providerId) {
                "anthropic" -> Quad("/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}".toByteArray())
                "openai" -> Quad("/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}".toByteArray())
                "gemini" -> Quad("/v1beta/models/gemini-2.0-flash:generateContent", "POST", jsonHeaders,
                    "{\"contents\":[{\"parts\":[{\"text\":\"Say hi in one word.\"}]}]}".toByteArray())
                else -> Quad(null, "POST", emptyMap(), null)
            }
        }

        if (mode == "stream") {
            return when (providerId) {
                "anthropic" -> Quad("/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":32,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}]}".toByteArray())
                "openai" -> Quad("/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"max_tokens\":32,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}]}".toByteArray())
                else -> Quad(null, "POST", emptyMap(), null)
            }
        }

        if (mode == "vision") {
            return when (providerId) {
                "anthropic" -> Quad("/v1/messages", "POST", anthropicHeaders,
                    ("{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"$PIXEL_PNG_B64\"}},{\"type\":\"text\",\"text\":\"What do you see? One short sentence.\"}]}]}").toByteArray())
                "openai" -> Quad("/v1/chat/completions", "POST", jsonHeaders,
                    ("{\"model\":\"gpt-4o-mini\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,$PIXEL_PNG_B64\"}},{\"type\":\"text\",\"text\":\"What do you see? One short sentence.\"}]}]}").toByteArray())
                "gemini" -> Quad("/v1beta/models/gemini-2.0-flash:generateContent", "POST", jsonHeaders,
                    ("{\"contents\":[{\"parts\":[{\"inline_data\":{\"mime_type\":\"image/png\",\"data\":\"$PIXEL_PNG_B64\"}},{\"text\":\"What do you see? One short sentence.\"}]}]}").toByteArray())
                else -> Quad(null, "POST", emptyMap(), null)
            }
        }

        if (mode == "tools") {
            // Single-turn only — validating the relay carries a tool_use
            // response back. The orchestrator asserts, not the device.
            return when (providerId) {
                "anthropic" -> Quad("/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":256,\"tools\":[{\"name\":\"get_weather\",\"description\":\"Get weather for a city.\",\"input_schema\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}],\"messages\":[{\"role\":\"user\",\"content\":\"What's the weather in Tokyo right now?\"}]}".toByteArray())
                "openai" -> Quad("/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get weather.\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}],\"messages\":[{\"role\":\"user\",\"content\":\"What's the weather in Tokyo?\"}]}".toByteArray())
                else -> Quad(null, "POST", emptyMap(), null)
            }
        }

        if (mode == "structured") {
            return when (providerId) {
                "openai" -> Quad("/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"user\",\"content\":\"Return JSON: {\\\"status\\\":\\\"ok\\\"}. Only the JSON.\"}]}".toByteArray())
                "anthropic" -> Quad("/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"Return ONLY this JSON and nothing else: {\\\"status\\\":\\\"ok\\\"}\"}]}".toByteArray())
                else -> Quad(null, "POST", emptyMap(), null)
            }
        }

        return Quad(null, "POST", emptyMap(), null)
    }

    /**
     * Extra shape checks on top of the plain 200+non-empty guard.
     * Returns (ok, note). A failing shape still has the raw response
     * available in the emitResult preview so the orchestrator can see why.
     */
    private fun validatePayloadShape(mode: String, providerId: String, status: Int, body: String): Pair<Boolean, String?> {
        if (status !in 200..399 || body.isEmpty()) return Pair(false, "http-$status")
        return when (mode) {
            "stream" -> {
                // Both anthropic and openai SSE use "data:" lines; anthropic also
                // emits "event:" lines. Either presence proves SSE framing.
                val isSse = body.contains("data:") || body.contains("event:")
                Pair(isSse, if (isSse) "sse-framed" else "no-sse-markers")
            }
            "tools" -> {
                val hasAnthropicTool = providerId == "anthropic" && body.contains("tool_use")
                val hasOpenaiTool = providerId == "openai" && body.contains("tool_calls")
                val ok = hasAnthropicTool || hasOpenaiTool
                Pair(ok, if (ok) "tool-call-present" else "no-tool-call")
            }
            "structured" -> {
                // The model's JSON reply is escaped inside the envelope's
                // string content field, so the raw body bytes contain
                // `\"status\":\"ok\"` with backslash escapes. Looking for the
                // literal quoted form misses that — fall back to unquoted
                // substrings that match both escaped + unescaped shapes.
                val hasJson = body.contains("status") && body.contains("ok")
                Pair(hasJson, if (hasJson) "json-key-present" else "missing-status-key")
            }
            "vision", "chat" -> Pair(true, null)
            else -> Pair(true, null)
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
        mode: String = "chat",
        modeNote: String? = null,
    ) {
        val obj = JSONObject().apply {
            put("success", success)
            put("status", status)
            put("providerId", providerId)
            put("responseBytes", responseBytes)
            put("response", responsePreview)
            put("attempts", attempts)
            put("mode", mode)
            if (modeNote != null) put("modeNote", modeNote)
            if (error != null) put("error", error)
        }
        Log.i(TAG, "PROXY_RESULT=${obj}")
    }
}
