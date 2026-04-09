package com.byoky.app.proxy

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.BuildConfig
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * Live smoke tests against real provider APIs.
 *
 * Each test:
 *   1. Asks TranslationEngine to translate a tiny anthropic-dialect request
 *      into the target family's dialect.
 *   2. Sends that translated body to the real provider via OkHttp.
 *   3. Translates the response back through the engine.
 *   4. Asserts the round-trip parses cleanly.
 *
 * This proves end-to-end correctness of the JS bridge against real network
 * conditions, without depending on Phase 2 (group routing) being landed yet.
 * The full proxy → bridge → upstream → bridge path is exercised at the
 * TranslationEngine layer, just bypassing ProxyService for now.
 *
 * Tests are gated behind environment-variable BuildConfig fields. If a key
 * isn't set, the test reports as skipped (assumeTrue) rather than failing.
 *
 * To run with all four families:
 *   export BYOKY_TEST_ANTHROPIC_KEY=sk-ant-...
 *   export BYOKY_TEST_OPENAI_KEY=sk-...
 *   export BYOKY_TEST_GEMINI_KEY=AIza...
 *   export BYOKY_TEST_COHERE_KEY=...
 *   ./gradlew connectedAndroidTest
 *
 * Live tests are slow and rate-limited. Run sparingly.
 */
@RunWith(AndroidJUnit4::class)
class TranslationLiveSmokeTest {
    private lateinit var engine: TranslationEngine
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val anthropicReqBody = """
        {"model":"claude-haiku-4-5-20251001","max_tokens":50,
         "messages":[{"role":"user","content":"Reply with the single word: pong"}]}
    """.trimIndent().replace("\n", "")

    @Before
    fun setup() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        engine = TranslationEngine.get(ctx)
        assumeTrue(
            "JavaScriptSandbox unsupported on this device",
            engine.isSupported
        )
    }

    @Test
    fun anthropicNativeRoundTrip() {
        val key = BuildConfig.TEST_ANTHROPIC_KEY
        assumeTrue("BYOKY_TEST_ANTHROPIC_KEY not set", key.isNotEmpty())

        // Same family — no translation needed, but we still go through the
        // engine surface to validate translateRequest is a no-op when src==dst.
        val ctxJson = """
            {"srcFamily":"anthropic","dstFamily":"anthropic",
             "srcProviderId":"anthropic","dstProviderId":"anthropic",
             "srcModel":"claude-haiku-4-5-20251001","dstModel":"claude-haiku-4-5-20251001"}
        """.trimIndent().replace("\n", "")

        val translated = engine.translateRequest(ctxJson, anthropicReqBody)
        val response = postJson(
            url = "https://api.anthropic.com/v1/messages",
            body = translated,
            headers = mapOf(
                "x-api-key" to key,
                "anthropic-version" to "2023-06-01",
            )
        )
        assertNotNull(response)
        val parsed = JSONObject(response!!)
        // Anthropic responses have content[].text
        assertTrue("anthropic response missing content[]", parsed.has("content"))
    }

    @Test
    fun openaiCrossFamilyRoundTrip() {
        val key = BuildConfig.TEST_OPENAI_KEY
        assumeTrue("BYOKY_TEST_OPENAI_KEY not set", key.isNotEmpty())

        val ctxJson = """
            {"srcFamily":"anthropic","dstFamily":"openai",
             "srcProviderId":"anthropic","dstProviderId":"openai",
             "srcModel":"claude-haiku-4-5-20251001","dstModel":"gpt-4o-mini"}
        """.trimIndent().replace("\n", "")

        val translatedReq = engine.translateRequest(ctxJson, anthropicReqBody)
        val rawResponse = postJson(
            url = "https://api.openai.com/v1/chat/completions",
            body = translatedReq,
            headers = mapOf("Authorization" to "Bearer $key"),
        )
        assertNotNull(rawResponse)

        // Translate openai response → anthropic dialect, then assert anthropic shape.
        val translatedResp = engine.translateResponse(ctxJson, rawResponse!!)
        val parsed = JSONObject(translatedResp)
        assertTrue("translated response missing content[]", parsed.has("content"))
    }

    @Test
    fun geminiCrossFamilyRoundTrip() {
        val key = BuildConfig.TEST_GEMINI_KEY
        assumeTrue("BYOKY_TEST_GEMINI_KEY not set", key.isNotEmpty())

        val ctxJson = """
            {"srcFamily":"anthropic","dstFamily":"gemini",
             "srcProviderId":"anthropic","dstProviderId":"gemini",
             "srcModel":"claude-haiku-4-5-20251001","dstModel":"gemini-2.5-flash"}
        """.trimIndent().replace("\n", "")

        val translatedReq = engine.translateRequest(ctxJson, anthropicReqBody)
        val rawResponse = postJson(
            url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            body = translatedReq,
            headers = mapOf("x-goog-api-key" to key),
        )
        assertNotNull(rawResponse)

        val translatedResp = engine.translateResponse(ctxJson, rawResponse!!)
        val parsed = JSONObject(translatedResp)
        assertTrue("translated response missing content[]", parsed.has("content"))
    }

    @Test
    fun cohereCrossFamilyRoundTrip() {
        val key = BuildConfig.TEST_COHERE_KEY
        assumeTrue("BYOKY_TEST_COHERE_KEY not set", key.isNotEmpty())

        val ctxJson = """
            {"srcFamily":"anthropic","dstFamily":"cohere",
             "srcProviderId":"anthropic","dstProviderId":"cohere",
             "srcModel":"claude-haiku-4-5-20251001","dstModel":"command-r-plus"}
        """.trimIndent().replace("\n", "")

        val translatedReq = engine.translateRequest(ctxJson, anthropicReqBody)
        val rawResponse = postJson(
            url = "https://api.cohere.com/v2/chat",
            body = translatedReq,
            headers = mapOf("Authorization" to "Bearer $key"),
        )
        assertNotNull(rawResponse)

        val translatedResp = engine.translateResponse(ctxJson, rawResponse!!)
        val parsed = JSONObject(translatedResp)
        assertTrue("translated response missing content[]", parsed.has("content"))
    }

    private fun postJson(url: String, body: String, headers: Map<String, String>): String? {
        val req = Request.Builder()
            .url(url)
            .post(body.toRequestBody("application/json".toMediaTypeOrNull()))
            .apply {
                headers.forEach { (k, v) -> header(k, v) }
                header("content-type", "application/json")
            }
            .build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string() ?: return null
            assertTrue(
                "upstream HTTP ${resp.code}: ${text.take(200)}",
                resp.isSuccessful
            )
            return text
        }
    }
}
