package com.byoky.app.proxy

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.BuildConfig
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.WalletStore
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Full-stack live test of [ProxyService.proxyRequest] — the Android analog of
 * the SDK chat calls in `e2e/tests/live-flow.spec.ts`. Seeds a fresh
 * [WalletStore] with real API keys (via BuildConfig fields populated from
 * BYOKY_TEST_*_KEY env vars), then drives each provider's native dialect
 * through the full proxy path: credential resolution → auth injection →
 * upstream HTTP → response return.
 *
 * Complements [TranslationLiveSmokeTest], which only exercises
 * [TranslationEngine] — this one goes through the real [ProxyService].
 *
 * Tests skip cleanly when a key is missing. Run with:
 *   export BYOKY_TEST_ANTHROPIC_KEY=sk-ant-...
 *   export BYOKY_TEST_OPENAI_KEY=sk-...
 *   export BYOKY_TEST_GEMINI_KEY=AIza...
 *   ./gradlew :app:connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class ProxyServiceLiveFlowTest {
    private lateinit var context: Context
    private lateinit var wallet: WalletStore
    private lateinit var proxy: ProxyService

    private val testPassword = "ProxyLiveFlowTest!long"

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearWalletState(context)
        wallet = WalletStore(context)
        wallet.createPassword(testPassword)
        proxy = ProxyService(wallet, context)
    }

    @After
    fun tearDown() {
        try { wallet.lock() } catch (_: Throwable) {}
        clearWalletState(context)
    }

    @Test
    fun anthropicProxyRoundTrip() {
        val key = BuildConfig.TEST_ANTHROPIC_KEY
        assumeTrue("BYOKY_TEST_ANTHROPIC_KEY not set", key.isNotEmpty())

        wallet.addCredential("anthropic", "e2e-anthropic", key, AuthMethod.API_KEY)

        val body = """
            {"model":"claude-haiku-4-5-20251001","max_tokens":50,
             "messages":[{"role":"user","content":"Reply with the single word: pong"}]}
        """.trimIndent().replace("\n", "")

        val response = proxy.proxyRequest(
            providerId = "anthropic",
            path = "/v1/messages",
            method = "POST",
            headers = mapOf(
                "content-type" to "application/json",
                "anthropic-version" to "2023-06-01",
            ),
            body = body.toByteArray(Charsets.UTF_8),
        )
        response.use {
            val text = it.body?.string().orEmpty()
            assertTrue("anthropic HTTP ${it.code}: ${text.take(200)}", it.isSuccessful)
            val parsed = JSONObject(text)
            assertTrue("anthropic response missing content[]", parsed.has("content"))
        }
    }

    @Test
    fun openaiProxyRoundTrip() {
        val key = BuildConfig.TEST_OPENAI_KEY
        assumeTrue("BYOKY_TEST_OPENAI_KEY not set", key.isNotEmpty())

        wallet.addCredential("openai", "e2e-openai", key, AuthMethod.API_KEY)

        val body = """
            {"model":"gpt-4o-mini","max_tokens":50,
             "messages":[{"role":"user","content":"Reply with the single word: pong"}]}
        """.trimIndent().replace("\n", "")

        val response = proxy.proxyRequest(
            providerId = "openai",
            path = "/v1/chat/completions",
            method = "POST",
            headers = mapOf("content-type" to "application/json"),
            body = body.toByteArray(Charsets.UTF_8),
        )
        response.use {
            val text = it.body?.string().orEmpty()
            assertTrue("openai HTTP ${it.code}: ${text.take(200)}", it.isSuccessful)
            val parsed = JSONObject(text)
            assertTrue("openai response missing choices[]", parsed.has("choices"))
        }
    }

    @Test
    fun geminiProxyRoundTrip() {
        val key = BuildConfig.TEST_GEMINI_KEY
        assumeTrue("BYOKY_TEST_GEMINI_KEY not set", key.isNotEmpty())

        wallet.addCredential("gemini", "e2e-gemini", key, AuthMethod.API_KEY)

        val body = """
            {"contents":[{"parts":[{"text":"Reply with the single word: pong"}]}],
             "generationConfig":{"maxOutputTokens":50}}
        """.trimIndent().replace("\n", "")

        val response = proxy.proxyRequest(
            providerId = "gemini",
            path = "/v1beta/models/gemini-2.5-flash:generateContent",
            method = "POST",
            headers = mapOf("content-type" to "application/json"),
            body = body.toByteArray(Charsets.UTF_8),
        )
        response.use {
            val text = it.body?.string().orEmpty()
            assertTrue("gemini HTTP ${it.code}: ${text.take(200)}", it.isSuccessful)
            val parsed = JSONObject(text)
            assertTrue("gemini response missing candidates[]", parsed.has("candidates"))
        }
    }

    private fun clearWalletState(ctx: Context) {
        ctx.getSharedPreferences("byoky_state", Context.MODE_PRIVATE)
            .edit().clear().commit()
        // Deleting the encrypted prefs file forces MasterKey to re-seed it
        // with no stored password_hash, so the next WalletStore lands in
        // UNINITIALIZED state.
        try {
            ctx.deleteSharedPreferences("byoky_vault")
        } catch (_: Throwable) {
            // deleteSharedPreferences is API 24+; ignore failures so this
            // test still runs in stripped-down instrumentation contexts.
        }
    }
}
