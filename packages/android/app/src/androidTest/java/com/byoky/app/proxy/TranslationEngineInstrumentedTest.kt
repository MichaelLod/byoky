package com.byoky.app.proxy

import android.content.Context
import android.util.Log
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * Instrumented bridge tests for the @byoky/core mobile bundle.
 *
 * These run on a real device/emulator (API ≥ 26, WebView ≥ 110) and exercise
 * the JS engine + handle table without making any network calls. Verifies the
 * bundle loads, the global is exposed, real translation round-trips work, and
 * the stream-handle lifecycle behaves. The translate logic itself is covered
 * by the vitest suite on Node — these tests prove the *bridge wiring* and the
 * host engine are correct, not the translation rules.
 *
 * JavaScriptSandbox is a bare V8 isolate: no Web APIs, so no global `URL`.
 * The bundle installs a fail-closed fallback (core/src/translate/url-fallback.ts)
 * when `URL` is missing; the URL tests below prove endpoint matching and
 * custom-host rewrites work in the real sandbox, not just on Node.
 *
 * Run (translation tests only — no network, no keys):
 *   ./gradlew connectedDebugAndroidTest \
 *     -Pandroid.testInstrumentationRunnerArguments.class=com.byoky.app.proxy.TranslationEngineInstrumentedTest
 *
 * Probe output is logged under the `ByokyBundleTest` tag:
 *   adb logcat -d -s ByokyBundleTest
 */
@RunWith(AndroidJUnit4::class)
class TranslationEngineInstrumentedTest {
    private lateinit var context: Context
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
        context = InstrumentationRegistry.getInstrumentation().targetContext
        engine = TranslationEngine.get(context)
        // Skip the entire suite on devices that don't ship a recent enough
        // WebView. assumeTrue() reports as "skipped" rather than failing.
        assumeTrue(
            "JavaScriptSandbox unsupported on this device — needs WebView ≥ 110",
            engine.isSupported
        )
        // Warm up explicitly so a load failure surfaces here instead of as a
        // swallowed null from one of the engine's best-effort wrappers. A
        // previous test may have shut the engine down (see withRawIsolate).
        runBlocking { engine.warmUp() }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Host engine + URL fallback
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun sandboxGlobalsBeforeAndAfterBundle() {
        val probe = """
            (function () {
              var names = ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa',
                'structuredClone', 'crypto', 'console', 'setTimeout', 'queueMicrotask', 'fetch',
                'Intl', 'WebAssembly', 'encodeURIComponent'];
              var out = {};
              for (var i = 0; i < names.length; i++) out[names[i]] = typeof globalThis[names[i]];
              try { new URL('https://api.openai.com/v1/chat/completions'); out.newURL = 'ok'; }
              catch (e) { out.newURL = String(e); }
              return JSON.stringify(out);
            })()
        """.trimIndent()

        withRawIsolate { isolate ->
            val before = JSONObject(isolate.eval(probe))
            Log.i(TAG, "globals BEFORE bundle: $before")
            isolate.eval(bundleSource())
            val after = JSONObject(isolate.eval(probe))
            Log.i(TAG, "globals AFTER bundle: $after")
            val urlImpl = isolate.eval("String(BYOKY_TRANSLATE.urlImpl)")
            Log.i(TAG, "BYOKY_TRANSLATE.urlImpl = $urlImpl")

            assertEquals("bundle must leave a URL constructor in place", "function", after.getString("URL"))
            assertEquals("ok", after.getString("newURL"))
            val expectedImpl = if (before.getString("URL") == "undefined") "fallback" else "native"
            assertEquals("fallback must be installed iff the host had no URL", expectedImpl, urlImpl)
        }
    }

    @Test
    fun fallbackUrlParsesProviderUrlsInSandbox() {
        // Expected values are what WHATWG `URL` (Node) returns for the same input.
        val cases = listOf(
            "https://api.anthropic.com/v1/messages" to
                "https:|api.anthropic.com|api.anthropic.com||/v1/messages|||https://api.anthropic.com",
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=AIzaTEST" to
                "https:|generativelanguage.googleapis.com|generativelanguage.googleapis.com||/v1beta/models/gemini-2.5-flash:streamGenerateContent|?alt=sse&key=AIzaTEST||https://generativelanguage.googleapis.com",
            "https://myres.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21" to
                "https:|myres.openai.azure.com|myres.openai.azure.com||/openai/deployments/gpt-4o/chat/completions|?api-version=2024-10-21||https://myres.openai.azure.com",
            "HTTPS://API.OpenAI.com:443/v1/Chat#frag" to
                "https:|api.openai.com|api.openai.com||/v1/Chat||#frag|https://api.openai.com",
            "http://localhost:11434/v1/chat/completions" to
                "http:|localhost:11434|localhost|11434|/v1/chat/completions|||http://localhost:11434",
            "http://127.0.0.1:1234/v1/models" to
                "http:|127.0.0.1:1234|127.0.0.1|1234|/v1/models|||http://127.0.0.1:1234",
            "http://[::1]:8080/v1/chat/completions" to
                "http:|[::1]:8080|[::1]|8080|/v1/chat/completions|||http://[::1]:8080",
            "http://[0:0:0:0:0:0:0:1]:80/x" to
                "http:|[::1]|[::1]||/x|||http://[::1]",
        )
        val hostile = listOf(
            "https://evil.com\\@api.openai.com/",
            "https://api.openai.com\t.evil.com/",
            "https://api.openai.com\n/",
            "https://ap%69.openai.com/",
            "https://аpi.openai.com/",
            "javascript:alert(1)",
            "https:api.openai.com/",
            "https://api.openai.com:99999/",
            "https://a@b@evil.com/",
            "https:///evil.com/",
            "https://0x7f.1/",
        )
        withBundleIsolate { isolate ->
            for ((input, expected) in cases) {
                val got = isolate.eval(
                    "(function(){var u=new URL(${jsString(input)});return [u.protocol,u.host,u.hostname,u.port,u.pathname,u.search,u.hash,u.origin].join('|');})()"
                )
                assertEquals("fields for $input", expected, got)
            }
            for (input in hostile) {
                val got = isolate.eval(
                    "(function(){try{var u=new URL(${jsString(input)});return 'parsed:'+u.hostname;}catch(e){return e instanceof TypeError?'TypeError':'other:'+e;}})()"
                )
                Log.i(TAG, "hostile ${jsString(input)} -> $got")
                // On a host with native URL some of these legitimately parse; the
                // hard guarantee only applies to the fallback.
                if (isolate.eval("String(BYOKY_TRANSLATE.urlImpl)") == "fallback") {
                    assertEquals("fallback must reject ${jsString(input)}", "TypeError", got)
                }
            }
        }
    }

    @Test
    fun chatEndpointMatchingPerFamily() {
        // providerId, url, expected — one chat URL per family plus non-chat
        // URLs, which prove the path is actually parsed (not trivially true).
        val cases = listOf(
            Triple("anthropic", "https://api.anthropic.com/v1/messages", true),
            Triple("anthropic", "https://api.anthropic.com/v1/messages?beta=true", true),
            Triple("anthropic", "https://api.anthropic.com/v1/models", false),
            Triple("openai", "https://api.openai.com/v1/chat/completions", true),
            Triple("openai", "https://api.openai.com/v1/embeddings", false),
            Triple("groq", "https://api.groq.com/openai/v1/chat/completions", true),
            Triple("azure_openai", "https://x.openai.azure.com/v1/chat/completions", true),
            Triple("gemini", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaTEST", true),
            Triple("gemini", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse", true),
            Triple("gemini", "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent", false),
            Triple("cohere", "https://api.cohere.com/v2/chat", true),
            Triple("cohere", "https://api.cohere.com/v2/embed", false),
            Triple("openai", "not a url", false),
            Triple("not-a-provider", "https://api.openai.com/v1/chat/completions", false),
        )
        withBundleIsolate { isolate ->
            for ((provider, url, expected) in cases) {
                val got = isolate.eval(
                    "BYOKY_TRANSLATE.isChatEndpoint(${jsString(provider)}, ${jsString(url)}) ? '1' : '0'"
                )
                assertEquals("isChatEndpoint($provider, $url)", if (expected) "1" else "0", got)
            }
        }
    }

    @Test
    fun azureRewriteUsesCredentialBaseUrl() {
        val azure = "https://x.openai.azure.com"
        assertEquals(
            "$azure/v1/chat/completions",
            engine.rewriteProxyUrl("azure_openai", "gpt-4o", false, azure),
        )
        assertEquals(
            "$azure/v1/chat/completions",
            engine.rewriteProxyUrl("azure_openai", "gpt-4o", true, "$azure/"),
        )
        assertEquals(
            "https://x.openai.azure.com:8443/v1/chat/completions",
            engine.rewriteProxyUrl("azure_openai", "gpt-4o", false, "https://x.openai.azure.com:8443"),
        )
        // Unsafe or missing overrides fail closed.
        for (bad in listOf(
            "",
            "not a url",
            "http://x.openai.azure.com",
            "https://u:p@x.openai.azure.com",
            "https://x.openai.azure.com?x=1",
            "https://x.openai.azure.com#frag",
            "https://x.openai.azure.com:99999",
            "javascript:alert(1)",
        )) {
            assertNull("override '$bad' must be refused", engine.rewriteProxyUrl("azure_openai", "gpt-4o", false, bad))
        }
    }

    @Test
    fun fixedHostProvidersIgnoreBaseUrlOverride() {
        val evil = "https://evil.example"
        assertEquals("https://api.anthropic.com/v1/messages",
            engine.rewriteProxyUrl("anthropic", "claude-sonnet-4-5", false, evil))
        assertEquals("https://api.openai.com/v1/chat/completions",
            engine.rewriteProxyUrl("openai", "gpt-4o", false, evil))
        assertEquals("https://api.mistral.ai/v1/chat/completions",
            engine.rewriteProxyUrl("mistral", "mistral-large-latest", false, evil))
        assertEquals("https://api.groq.com/openai/v1/chat/completions",
            engine.rewriteProxyUrl("groq", "llama-3.3-70b-versatile", false, evil))
        assertEquals("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
            engine.rewriteProxyUrl("gemini", "gemini-2.5-flash", false, evil))
        assertEquals("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
            engine.rewriteProxyUrl("gemini", "gemini-2.5-flash", true, evil))
        assertEquals("https://api.cohere.com/v2/chat",
            engine.rewriteProxyUrl("cohere", "command-r-plus", false, evil))
        // Same results with no override at all.
        assertEquals("https://api.anthropic.com/v1/messages",
            engine.rewriteProxyUrl("anthropic", "claude-sonnet-4-5", false, null))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Translation round-trips + handle table
    // ──────────────────────────────────────────────────────────────────────

    @Test
    fun bundleLoadsAndExposesVersion() {
        val version = engine.bundleVersion()
        assertNotNull("bundleVersion should not be null after warmUp", version)
        // mobile-entry.ts ships with a hardcoded version string we can pin against.
        assertEquals("0.5.3", version)
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
    fun crossFamilyRoundTripViaBuiltContext() {
        // Build the context the way ProxyService does, translate the request,
        // then translate a canned upstream response back to the source dialect.
        assertTrue(engine.shouldTranslate("anthropic", "gemini"))
        val ctx = engine.buildTranslationContext(
            "anthropic", "gemini", "claude-sonnet-4-5", "gemini-2.5-flash", false, "req_test_1",
        )
        val geminiReq = JSONObject(engine.translateRequest(ctx, anthropicReqBody))
        assertNotNull("gemini request must carry contents[]", geminiReq.optJSONArray("contents"))

        val geminiResp = """
            {"candidates":[{"content":{"role":"model","parts":[{"text":"pong"}]},"finishReason":"STOP"}],
             "usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":1,"totalTokenCount":4}}
        """.trimIndent().replace("\n", "")
        val anthropicResp = JSONObject(engine.translateResponse(ctx, geminiResp))
        assertEquals("message", anthropicResp.optString("type"))
        val content = anthropicResp.getJSONArray("content")
        assertEquals("pong", content.getJSONObject(0).optString("text"))
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

    // ──────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────

    private fun bundleSource(): String =
        context.assets.open("mobile.js").bufferedReader().use { it.readText() }

    /**
     * Run [block] against a fresh isolate in our own sandbox, so the test can
     * observe the host's globals before the bundle touches them. Only one
     * JavaScriptSandbox may be connected per process, so the engine's is
     * released first; the next test's setup re-warms it.
     */
    private fun <T> withRawIsolate(block: (JavaScriptIsolate) -> T): T {
        engine.shutdown()
        val sandbox = JavaScriptSandbox.createConnectedInstanceAsync(context).get(30, TimeUnit.SECONDS)
        try {
            val isolate = sandbox.createIsolate()
            try {
                return block(isolate)
            } finally {
                isolate.close()
            }
        } finally {
            sandbox.close()
        }
    }

    /** Like [withRawIsolate], with the real mobile.js already evaluated. */
    private fun <T> withBundleIsolate(block: (JavaScriptIsolate) -> T): T = withRawIsolate { isolate ->
        isolate.eval(bundleSource())
        block(isolate)
    }

    private fun JavaScriptIsolate.eval(js: String): String =
        evaluateJavaScriptAsync(js).get(30, TimeUnit.SECONDS) ?: ""

    /** JSON-style string literal; inputs here are test constants. */
    private fun jsString(s: String): String = JSONObject.quote(s)

    private companion object {
        const val TAG = "ByokyBundleTest"
    }
}
