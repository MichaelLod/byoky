package com.byoky.app.proxy

import android.content.Context
import androidx.javascriptengine.IsolateStartupParameters
import androidx.javascriptengine.JavaScriptIsolate
import androidx.javascriptengine.JavaScriptSandbox
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicReference

/**
 * Bridges native code to the byoky cross-family translation layer.
 *
 * The translation layer lives in @byoky/core and is shipped as a self-contained
 * IIFE bundle (assets/mobile.js, built by tsup, synced via
 * scripts/sync-mobile-bundle.sh). On first use we create a JavaScriptSandbox
 * isolate, evaluate the bundle, and call into the global BYOKY_TRANSLATE
 * bridge object for every translation. There is no native port of the
 * translate layer, by design — one source of truth, no Kotlin/Swift/TS
 * divergence to debug.
 *
 * Why androidx.javascriptengine: Google-official, V8-backed, runs in an
 * isolated process for security. Even a JS sandbox RCE can't reach the
 * credentials in the main process. Adds ~1 MB to the APK and requires
 * Android WebView ≥ 110 (Android 12L practically; we throw on unsupported
 * devices and Phase 2 routing checks isSupported() before activating).
 *
 * Threading: JavaScriptSandbox is asynchronous (returns ListenableFuture).
 * We expose blocking methods because the proxy pipeline is already on
 * background threads (OkHttp call queue) and the translation step is a
 * single fast call. Internal sync uses kotlinx.coroutines runBlocking to
 * await the futures inside the bridge methods.
 *
 * Stream translators are stateful so we can't expose them as Kotlin objects.
 * The JS side holds them in a handle table; we pass integer handles back
 * and forth.
 */
class TranslationEngine private constructor(private val appContext: Context) {

    /**
     * Engine errors surfaced to native callers. JS exceptions thrown inside
     * the bundle (e.g. TranslationError for unrepresentable features) are
     * wrapped in [TranslationFailed].
     */
    sealed class EngineException(message: String) : RuntimeException(message) {
        class NotSupported(msg: String) : EngineException(msg)
        class BundleLoadFailed(msg: String) : EngineException(msg)
        class BridgeNotInitialized : EngineException("BYOKY_TRANSLATE global not exposed by bundle")
        class TranslationFailed(msg: String) : EngineException(msg)
        class InvalidResult : EngineException("bridge returned an invalid result")
    }

    private val initMutex = Mutex()
    private val sandboxRef = AtomicReference<JavaScriptSandbox?>(null)
    private val isolateRef = AtomicReference<JavaScriptIsolate?>(null)
    @Volatile private var loaded = false

    /**
     * True if the device supports JavaScriptSandbox (WebView ≥ M110).
     * Phase 2 routing must check this before activating cross-family
     * translation; Phase 1b ships without consumers.
     */
    val isSupported: Boolean
        get() = JavaScriptSandbox.isSupported()

    /** Lazily create the sandbox + isolate and evaluate the bundle. Idempotent. */
    suspend fun warmUp() {
        if (loaded) return
        initMutex.withLock {
            if (loaded) return
            if (!JavaScriptSandbox.isSupported()) {
                throw EngineException.NotSupported(
                    "JavaScriptSandbox unavailable on this device (requires WebView ≥ 110)"
                )
            }
            val sandbox: JavaScriptSandbox = try {
                JavaScriptSandbox.createConnectedInstanceAsync(appContext).await()
            } catch (t: Throwable) {
                throw EngineException.BundleLoadFailed("sandbox connect failed: ${t.message}")
            }
            sandboxRef.set(sandbox)

            val isolate: JavaScriptIsolate = try {
                val params = IsolateStartupParameters().apply {
                    // Generous heap for translation; bundle is ~100 KB but
                    // request bodies can include base64 images.
                    maxHeapSizeBytes = 32L * 1024 * 1024
                }
                sandbox.createIsolate(params)
            } catch (t: Throwable) {
                throw EngineException.BundleLoadFailed("isolate create failed: ${t.message}")
            }
            isolateRef.set(isolate)

            // Load the bundle from assets/. The IIFE assigns globalThis.BYOKY_TRANSLATE
            // when evaluated. We then verify it's present via a tiny probe script.
            val bundleSource: String = try {
                appContext.assets.open("mobile.js").bufferedReader().use { it.readText() }
            } catch (t: Throwable) {
                throw EngineException.BundleLoadFailed("read mobile.js failed: ${t.message}")
            }
            try {
                isolate.evaluateJavaScriptAsync(bundleSource).await()
            } catch (t: Throwable) {
                throw EngineException.BundleLoadFailed("evaluate bundle failed: ${t.message}")
            }
            // Probe: confirm the global is wired up.
            val probe: String? = try {
                isolate.evaluateJavaScriptAsync(
                    "typeof BYOKY_TRANSLATE === 'object' && typeof BYOKY_TRANSLATE.translateRequest === 'function' ? BYOKY_TRANSLATE.version : ''"
                ).await()
            } catch (t: Throwable) {
                throw EngineException.BundleLoadFailed("probe failed: ${t.message}")
            }
            if (probe == null || probe.isEmpty()) {
                throw EngineException.BridgeNotInitialized()
            }
            loaded = true
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Translation API
    //
    // The JavaScriptSandbox bridge only ferries strings, so we build small
    // JS expressions that call the bridge with literal-encoded arguments and
    // stringify the result. Inputs are JSON-encoded on the Kotlin side via
    // jsLiteral() to defeat any string-injection edge cases (the alternative
    // is provideNamedData(), which requires more setup for marginal benefit
    // at this call rate).
    // ──────────────────────────────────────────────────────────────────────

    /** Translate a request body from src to dst dialect. */
    fun translateRequest(contextJson: String, body: String): String =
        callStringMethod("translateRequest", listOf(contextJson, body))

    /** Translate a non-streaming response body from dst back to src dialect. */
    fun translateResponse(contextJson: String, body: String): String =
        callStringMethod("translateResponse", listOf(contextJson, body))

    /**
     * Open a stateful stream translator. Returns an integer handle that
     * must be passed to [processStreamChunk] / [flushStreamTranslator] and
     * eventually released via either flush (which releases) or
     * [releaseStreamTranslator] (which discards without flushing).
     */
    fun createStreamTranslator(contextJson: String): Int {
        val expr = "String(BYOKY_TRANSLATE.createStreamTranslator(${jsLiteral(contextJson)}))"
        val result = evalSync(expr)
        return result.toIntOrNull() ?: throw EngineException.InvalidResult()
    }

    /** Process one upstream SSE chunk through a stream handle. */
    fun processStreamChunk(handle: Int, chunk: String): String {
        val expr = "BYOKY_TRANSLATE.processStreamChunk($handle, ${jsLiteral(chunk)})"
        return evalSync(expr)
    }

    /** Flush any buffered output for a stream handle and release it. */
    fun flushStreamTranslator(handle: Int): String {
        val expr = "BYOKY_TRANSLATE.flushStreamTranslator($handle)"
        return evalSync(expr)
    }

    /** Release a stream handle without flushing (e.g. on cancellation). */
    fun releaseStreamTranslator(handle: Int) {
        val expr = "(BYOKY_TRANSLATE.releaseStreamTranslator($handle), '')"
        try { evalSync(expr) } catch (_: Throwable) { /* swallow — cleanup is best-effort */ }
    }

    /** Bundle version, for debug surfaces. */
    fun bundleVersion(): String? = try {
        evalSync("String(BYOKY_TRANSLATE.version || '')").ifEmpty { null }
    } catch (_: Throwable) { null }

    // ──────────────────────────────────────────────────────────────────────
    // Routing helpers
    //
    // Wrappers around bridge functions used by RoutingResolver. The native
    // side intentionally does not duplicate the family→providers mapping —
    // it lives in core. These thin wrappers are the only place mobile asks
    // "is this pair translatable?" and "what's the destination URL?"
    // ──────────────────────────────────────────────────────────────────────

    /**
     * True iff a request from `srcProviderId` should be translated to
     * `dstProviderId`. False on errors / unknown providers — caller treats
     * false as "no translation, use direct credential lookup".
     */
    fun shouldTranslate(srcProviderId: String, dstProviderId: String): Boolean {
        return try {
            val expr = "BYOKY_TRANSLATE.shouldTranslate(${jsLiteral(srcProviderId)}, ${jsLiteral(dstProviderId)}) ? '1' : '0'"
            evalSync(expr) == "1"
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Build a JSON-encoded TranslationContext for use with translateRequest /
     * translateResponse / createStreamTranslator. Throws if either provider
     * is outside a known family — caller is expected to gate on
     * shouldTranslate first.
     */
    fun buildTranslationContext(
        srcProviderId: String,
        dstProviderId: String,
        srcModel: String,
        dstModel: String,
        isStreaming: Boolean,
        requestId: String,
    ): String {
        val args = listOf(
            jsLiteral(srcProviderId),
            jsLiteral(dstProviderId),
            jsLiteral(srcModel),
            jsLiteral(dstModel),
            if (isStreaming) "true" else "false",
            jsLiteral(requestId),
        ).joinToString(", ")
        return evalSync("BYOKY_TRANSLATE.buildTranslationContext($args)")
    }

    /**
     * Rewrite an upstream URL when routing cross-family. Returns null when
     * the destination has no adapter or can't build a URL.
     */
    fun rewriteProxyUrl(dstProviderId: String, model: String, stream: Boolean): String? {
        return try {
            val expr =
                "(function(){var u=BYOKY_TRANSLATE.rewriteProxyUrl(${jsLiteral(dstProviderId)},${jsLiteral(model)},${if (stream) "true" else "false"});return u==null?'':String(u);})()"
            val result = evalSync(expr)
            result.ifEmpty { null }
        } catch (_: Throwable) {
            null
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────

    private fun callStringMethod(method: String, args: List<String>): String {
        val argsJs = args.joinToString(", ") { jsLiteral(it) }
        return evalSync("BYOKY_TRANSLATE.$method($argsJs)")
    }

    /**
     * Encode an arbitrary string as a JavaScript string literal. We can't use
     * JSON.stringify on the Kotlin side because the string may contain non-
     * BMP characters that need surrogate-safe escaping; building a literal
     * with explicit \uXXXX for control chars and quote escaping avoids the
     * trip through org.json (which mangles some sequences).
     */
    private fun jsLiteral(s: String): String {
        val sb = StringBuilder(s.length + 2)
        sb.append('"')
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\u2028' -> sb.append("\\u2028")
                '\u2029' -> sb.append("\\u2029")
                else -> if (c.code < 0x20) {
                    sb.append("\\u%04x".format(c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }

    private fun evalSync(expr: String): String {
        if (!loaded) runBlocking { warmUp() }
        val isolate = isolateRef.get() ?: throw EngineException.BridgeNotInitialized()
        return try {
            runBlocking { isolate.evaluateJavaScriptAsync(expr).await() ?: "" }
        } catch (t: Throwable) {
            throw EngineException.TranslationFailed(t.message ?: "unknown JS error")
        }
    }

    /** Tear down the sandbox. App lifecycle should call this on full shutdown. */
    fun shutdown() {
        try { isolateRef.getAndSet(null)?.close() } catch (_: Throwable) {}
        try { sandboxRef.getAndSet(null)?.close() } catch (_: Throwable) {}
        loaded = false
    }

    // ──────────────────────────────────────────────────────────────────────
    // Self-test — debug surface for verifying the bundle loads + round-trips.
    // Phase 1b ships without an instrumented test target; this method gives
    // a hook for a Settings debug screen to call. Phase 1c will scaffold real
    // androidTest infrastructure.
    // ──────────────────────────────────────────────────────────────────────

    fun runSelfTest(): String {
        val lines = mutableListOf<String>()
        try {
            if (!isSupported) {
                return "✗ JavaScriptSandbox not supported on this device"
            }
            runBlocking { warmUp() }
            lines += "✓ bundle loaded"
            bundleVersion()?.let { lines += "  bundle version: $it" }

            val ctxJson = """
                {"srcFamily":"anthropic","dstFamily":"openai",
                 "srcProviderId":"anthropic","dstProviderId":"openai",
                 "srcModel":"claude-sonnet-4-5","dstModel":"gpt-4o"}
            """.trimIndent().replace("\n", "")
            val reqBody = """
                {"model":"claude-sonnet-4-5","max_tokens":100,
                 "messages":[{"role":"user","content":"hi"}]}
            """.trimIndent().replace("\n", "")

            val translated = translateRequest(ctxJson, reqBody)
            lines += "✓ translateRequest round-trip"
            lines += "  output: ${translated.take(120)}..."

            val handle = createStreamTranslator(ctxJson)
            lines += "✓ createStreamTranslator → handle $handle"
            releaseStreamTranslator(handle)
            lines += "✓ releaseStreamTranslator"

            lines += "--- self-test passed ---"
        } catch (t: Throwable) {
            lines += "✗ self-test failed: ${t.message}"
        }
        return lines.joinToString("\n")
    }

    companion object {
        @Volatile private var instance: TranslationEngine? = null

        /** Acquire the process-wide TranslationEngine. App context only. */
        fun get(context: Context): TranslationEngine {
            return instance ?: synchronized(this) {
                instance ?: TranslationEngine(context.applicationContext).also { instance = it }
            }
        }
    }
}
