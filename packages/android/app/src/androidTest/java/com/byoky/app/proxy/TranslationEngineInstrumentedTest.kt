package com.byoky.app.proxy

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented bridge tests for the @byoky/core mobile bundle.
 *
 * These run on a real device/emulator (API ≥ 26, WebView ≥ 110) and exercise
 * the JS engine + handle table without making any network calls. Verifies the
 * bundle loads, the global is exposed, real translation round-trips work, and
 * the stream-handle lifecycle behaves. The translate logic itself is already
 * covered by 572 unit tests on Node — these tests prove the *bridge wiring*
 * is correct, not the translation rules.
 *
 * Run: `./gradlew connectedAndroidTest`
 */
@RunWith(AndroidJUnit4::class)
class TranslationEngineInstrumentedTest {
    private lateinit var engine: TranslationEngine

    private val anthropicToOpenaiCtx = """
        {"srcFamily":"anthropic","dstFamily":"openai",
         "srcProviderId":"anthropic","dstProviderId":"openai",
         "srcModel":"claude-sonnet-4-5","dstModel":"gpt-4o"}
    """.trimIndent().replace("\n", "")

    private val anthropicReqBody = """
        {"model":"claude-sonnet-4-5","max_tokens":100,
         "messages":[{"role":"user","content":"hi"}]}
    """.trimIndent().replace("\n", "")

    @Before
    fun setup() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        engine = TranslationEngine.get(ctx)
        // Skip the entire suite on devices that don't ship a recent enough
        // WebView. assumeTrue() reports as "skipped" rather than failing.
        assumeTrue(
            "JavaScriptSandbox unsupported on this device — needs WebView ≥ 110",
            engine.isSupported
        )
    }

    @Test
    fun bundleLoadsAndExposesVersion() {
        val version = engine.bundleVersion()
        assertNotNull("bundleVersion should not be null after warmUp", version)
        // mobile-entry.ts ships with a hardcoded version string we can pin against.
        assertEquals("0.5.0", version)
    }

    @Test
    fun translateRequestAnthropicToOpenai() {
        val translated = engine.translateRequest(anthropicToOpenaiCtx, anthropicReqBody)
        val parsed = JSONObject(translated)
        // OpenAI dialect uses `model` (post-translation it should be the dst model).
        assertEquals("gpt-4o", parsed.optString("model"))
        // OpenAI dialect uses `messages[]` with content as a string for plain text.
        val messages = parsed.optJSONArray("messages")
        assertNotNull(messages)
        assertEquals(1, messages!!.length())
        val first = messages.getJSONObject(0)
        assertEquals("user", first.optString("role"))
    }

    @Test
    fun streamHandleLifecycle() {
        val handle = engine.createStreamTranslator(anthropicToOpenaiCtx)
        assertTrue("stream handle must be positive integer", handle > 0)
        // Releasing should be idempotent / not throw on a fresh handle.
        engine.releaseStreamTranslator(handle)
        // After release the handle is gone — flushing should now error.
        try {
            engine.flushStreamTranslator(handle)
            fail("expected EngineException for released handle")
        } catch (_: TranslationEngine.EngineException) {
            // expected
        }
    }

    @Test
    fun unknownStreamHandleErrors() {
        try {
            engine.processStreamChunk(99999, "data: {}\n\n")
            fail("expected EngineException for unknown handle")
        } catch (_: TranslationEngine.EngineException) {
            // expected
        }
    }

    @Test
    fun malformedContextJsonPropagatesError() {
        try {
            engine.translateRequest("{ not valid json", anthropicReqBody)
            fail("expected EngineException for malformed JSON ctx")
        } catch (_: TranslationEngine.EngineException) {
            // expected — JS-side JSON.parse throws, error bubbles back
        }
    }

    @Test
    fun specialCharactersInBodyAreEscapedSafely() {
        // The Kotlin jsLiteral() encoder must handle quotes, backslashes, and
        // line separators without breaking the bundle's JSON.parse.
        val body = """
            {"model":"claude-sonnet-4-5","max_tokens":1,
             "messages":[{"role":"user","content":"line\nwith \"quotes\" and \\ slashes"}]}
        """.trimIndent().replace("\n", "")
        // Should not throw — the bridge accepts the body and JSON.parse succeeds.
        val translated = engine.translateRequest(anthropicToOpenaiCtx, body)
        val parsed = JSONObject(translated)
        assertEquals("gpt-4o", parsed.optString("model"))
    }
}
