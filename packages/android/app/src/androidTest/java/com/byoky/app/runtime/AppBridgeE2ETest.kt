package com.byoky.app.runtime

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.byoky.app.data.TokenAllowance
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.ProxyService
import com.byoky.app.testing.FakeServer
import com.byoky.app.testing.clearWalletState
import com.byoky.app.ui.screens.AppPageState
import com.byoky.app.ui.screens.AppWebViewClient
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * The in-wallet browser end to end (F091), as iOS's NativeBridgeE2ETests: a
 * real WebView on https://app.example, wired as AppRuntimeScreen wires it
 * (origin-scoped native object and bootstrap script, AppWebViewClient), runs
 * the production bridge script, posts the SDK's `BYOKY_*` messages and
 * collects the replies from its MessagePort; AppBridge proxies the requests
 * to a local fake provider (an Ollama credential on 127.0.0.1).
 */
@RunWith(AndroidJUnit4::class)
class AppBridgeE2ETest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private lateinit var wallet: WalletStore
    private lateinit var server: FakeServer
    private var page: BridgePage? = null

    @Before
    fun setup() {
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER))
        assumeTrue(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
        clearWalletState(context)
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword("AppBridgeE2ETest!long") }
        server = FakeServer()
        runBlocking { wallet.addCredential("ollama", "local", KEY, baseUrl = server.base) }
    }

    @After
    fun tearDown() {
        page?.close()
        if (::server.isInitialized) server.close()
        if (::wallet.isInitialized) try { wallet.lock() } catch (_: Throwable) {}
        clearWalletState(context)
    }

    private fun open(html: String = PAGE): BridgePage = BridgePage(wallet, html).also { page = it }

    // ── Connect ──────────────────────────────────────────────────────────

    /** The connect reply lists every provider the app asked for (F101). */
    @Test
    fun connectListsTheRequestedProviders() {
        val p = open()
        val replies = p.send(JSONObject()
            .put("type", "BYOKY_CONNECT_REQUEST").put("requestId", "connect-1")
            .put("payload", JSONObject().put("providers", JSONArray()
                .put(JSONObject().put("id", "ollama").put("required", true))
                .put(JSONObject().put("id", "mistral").put("required", false)))))

        assertEquals(listOf("BYOKY_CONNECT_RESPONSE"), replies.map { it.getString("type") })
        val payload = replies.single().getJSONObject("payload")
        assertTrue(payload.getString("sessionKey").isNotEmpty())
        val providers = payload.getJSONObject("providers")
        assertTrue(providers.getJSONObject("ollama").getBoolean("available"))
        assertTrue(providers.getJSONObject("mistral").has("available"))
        assertTrue(wallet.sessions.value.any { it.appOrigin == ORIGIN })
    }

    // ── Pass-through ─────────────────────────────────────────────────────

    @Test
    fun aJsonReplyPassesThrough() {
        val p = open()
        val body = """{"id":"c1","choices":[{"message":{"role":"assistant","content":"hi ✓"}}],"usage":{"prompt_tokens":7,"completion_tokens":5}}"""
        server.reply = FakeServer.Reply("application/json", body.toByteArray())

        val replies = p.proxy(p.connect(), CHAT)

        assertEquals("BYOKY_PROXY_RESPONSE_META", replies.first().getString("type"))
        assertEquals(200, replies.first().getInt("status"))
        assertEquals("BYOKY_PROXY_RESPONSE_DONE", replies.last().getString("type"))
        assertEquals(body, text(replies))
        // The key is attached natively; the page never had it.
        assertEquals("Bearer $KEY", server.requests.single().headers["authorization"])
        assertEquals(12, wallet.tokenUsage(ORIGIN))
    }

    @Test
    fun anEventStreamPassesThroughAndEndsWithDone() {
        val p = open()
        val events = "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: [DONE]\n\n"
        server.reply = FakeServer.Reply("text/event-stream", events.toByteArray())

        val replies = p.proxy(p.connect(), """{"model":"llama3.1","stream":true,"messages":[]}""")

        assertEquals("BYOKY_PROXY_RESPONSE_DONE", replies.last().getString("type"))
        assertEquals(events, text(replies))
    }

    @Test
    fun aBinaryReplyArrivesByteForByte() {
        val p = open()
        val audio = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x64) + ByteArray(512) { it.toByte() }
        server.reply = FakeServer.Reply("audio/mpeg", audio)

        val replies = p.proxy(p.connect(), CHAT)

        assertEquals("BYOKY_PROXY_RESPONSE_DONE", replies.last().getString("type"))
        val chunks = replies.filter { it.getString("type") == "BYOKY_PROXY_RESPONSE_CHUNK" }
        assertTrue(chunks.isNotEmpty())
        assertTrue(chunks.all { it.optString("chunkEncoding") == "base64" })
        val received = chunks.fold(ByteArray(0)) { out, c -> out + Base64.getDecoder().decode(c.getString("chunk")) }
        assertArrayEquals(audio, received)
    }

    /** An OpenAI-dialect provider behind an Anthropic app: replies come back in the app's dialect. */
    @Test
    fun aTranslatedRequestRoundTrips() {
        val group = wallet.createGroup("Local", "ollama", model = "llama3.1")
        wallet.setAppGroup(ORIGIN, group.id)
        val p = open()
        server.reply = FakeServer.Reply("application/json",
            """{"id":"c1","object":"chat.completion","model":"llama3.1","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}""".toByteArray())

        val replies = p.proxy(
            p.connect(),
            """{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}""",
            providerId = "anthropic", url = "https://api.anthropic.com/v1/messages",
        )

        assertEquals("BYOKY_PROXY_RESPONSE_DONE", replies.last().getString("type"))
        assertTrue(server.requests.single().line.startsWith("POST /v1/chat/completions"))
        val message = JSONObject(text(replies))
        assertEquals("message", message.getString("type"))
        assertEquals("hello", message.getJSONArray("content").getJSONObject(0).getString("text"))
    }

    // ── Cancellation, reload, lock, revoke ──────────────────────────────

    /** Cancelled after the request went out: the provider bills it, so it is logged as 499; the page hears nothing more. */
    @Test
    fun cancelStopsTheUpstreamCall() {
        val p = open()
        val key = p.connect()
        server.reply = FakeServer.Reply("application/json", ByteArray(0), hold = true)

        val replies = p.proxyInBackground(key, "cancel-1")
        waitUntil { server.requests.size == 1 }
        p.post(JSONObject().put("type", "BYOKY_PROXY_CANCEL").put("requestId", "cancel-1"))

        waitUntil { server.closedByClient == 1 }
        assertTrue(replies.get(10, TimeUnit.SECONDS).isEmpty())
        waitUntil { wallet.requestLogs.value.isNotEmpty() }
        assertEquals(499, wallet.requestLogs.value.first().statusCode)
    }

    /**
     * Reload: a new document replaces the page, and the old page's request
     * stops, charged as cancelled (F006). Its session key ends with it; the
     * new page connects again.
     */
    @Test
    fun aReloadStopsTheOldPagesRequests() {
        val p = open()
        val oldKey = p.connect()
        server.reply = FakeServer.Reply("application/json", ByteArray(0), hold = true)

        p.proxyInBackground(oldKey, "reload-1")
        waitUntil { server.requests.size == 1 }
        p.reload()

        waitUntil { server.closedByClient == 1 }
        waitUntil { wallet.requestLogs.value.isNotEmpty() }
        assertEquals(499, wallet.requestLogs.value.first().statusCode)
        assertTrue(wallet.tokenUsage(ORIGIN) > 0)

        server.reply = FakeServer.Reply("application/json", "{}".toByteArray())
        val stale = p.proxy(oldKey, CHAT)
        assertEquals("SESSION_EXPIRED", stale.single().getJSONObject("error").getString("code"))
        assertEquals("BYOKY_PROXY_RESPONSE_DONE", p.proxy(p.connect(), CHAT).last().getString("type"))
    }

    /** pushState and #fragment changes keep the document, and its requests (F006). */
    @Test
    fun aSameDocumentNavigationKeepsTheRequests() {
        val p = open()
        val key = p.connect()
        server.reply = FakeServer.Reply("application/json", ByteArray(0), hold = true)

        p.proxyInBackground(key, "spa-1")
        waitUntil { server.requests.size == 1 }
        p.eval("history.pushState({}, '', '/chat/2'); location.hash = 'msg-3';")
        Thread.sleep(1_500)

        assertEquals(0, server.closedByClient)
        p.post(JSONObject().put("type", "BYOKY_PROXY_CANCEL").put("requestId", "spa-1"))
        waitUntil { server.closedByClient == 1 }
    }

    /** A locked wallet answers SESSION_EXPIRED (401), as from the extension. */
    @Test
    fun aLockedWalletEndsTheSession() {
        val p = open()
        val key = p.connect()
        wallet.lock()

        val replies = p.proxy(key, CHAT)

        assertEquals(listOf("BYOKY_PROXY_RESPONSE_ERROR"), replies.map { it.getString("type") })
        assertEquals(401, replies.single().getInt("status"))
        assertEquals("SESSION_EXPIRED", replies.single().getJSONObject("error").getString("code"))
        assertTrue(server.requests.isEmpty())
    }

    /** Disconnected in the Connected tab: the key stops working and the app can't reconnect on its own. */
    @Test
    fun aRevokedAppGetsSessionExpiredAndCantReconnect() {
        val p = open()
        val key = p.connect()
        wallet.revokeSession(wallet.sessions.value.single { it.appOrigin == ORIGIN })

        val replies = p.proxy(key, CHAT)
        assertEquals(401, replies.single().getInt("status"))
        assertEquals("SESSION_EXPIRED", replies.single().getJSONObject("error").getString("code"))
        assertFalse(p.status(key))
        val reconnect = p.send(JSONObject().put("type", "BYOKY_CONNECT_REQUEST").put("requestId", "connect-2").put("payload", JSONObject()))
        assertEquals("BYOKY_ERROR", reconnect.single().getString("type"))
        assertEquals("USER_REJECTED", reconnect.single().getJSONObject("payload").getString("code"))
        assertTrue(server.requests.isEmpty())
    }

    /** The app disconnects itself with its own key; another key is ignored. */
    @Test
    fun disconnectNeedsTheSessionsKey() {
        val p = open()
        val key = p.connect()

        p.post(JSONObject().put("type", "BYOKY_DISCONNECT").put("payload", JSONObject().put("sessionKey", "app_not-the-key")))
        assertTrue(p.status(key))
        assertTrue(wallet.sessions.value.any { it.appOrigin == ORIGIN })

        p.post(JSONObject().put("type", "BYOKY_DISCONNECT").put("payload", JSONObject().put("sessionKey", key)))
        waitUntil { wallet.sessions.value.none { it.appOrigin == ORIGIN } }
        assertFalse(p.status(key))
        // Not a revoke: the app may connect again.
        assertEquals("BYOKY_CONNECT_RESPONSE", p.send(JSONObject().put("type", "BYOKY_CONNECT_REQUEST")
            .put("requestId", "connect-3").put("payload", JSONObject())).single().getString("type"))
    }

    /** Usage is this session's, and null without its key (F104). */
    @Test
    fun sessionUsageIsTheSessionsOwn() {
        val p = open()
        val key = p.connect()
        server.reply = FakeServer.Reply("application/json",
            """{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5}}""".toByteArray())
        p.proxy(key, CHAT)

        val usage = p.send(JSONObject().put("type", "BYOKY_SESSION_USAGE").put("requestId", "usage-1")
            .put("payload", JSONObject().put("sessionKey", key))).single()
        assertEquals("BYOKY_SESSION_USAGE_RESPONSE", usage.getString("type"))
        val totals = usage.getJSONObject("payload")
        assertEquals(1, totals.getInt("requests"))
        assertEquals(7, totals.getInt("inputTokens"))
        assertEquals(5, totals.getInt("outputTokens"))
        assertNotNull(totals.getJSONObject("byProvider").optJSONObject("ollama"))

        val stranger = p.send(JSONObject().put("type", "BYOKY_SESSION_USAGE").put("requestId", "usage-2")
            .put("payload", JSONObject().put("sessionKey", "app_someone-else"))).single()
        assertTrue(stranger.isNull("payload"))
    }

    // ── Allowances ───────────────────────────────────────────────────────

    /** The first request's usage is settled; once the allowance is used up the next one never goes out. */
    @Test
    fun theAllowanceIsSettledAndThenEnforced() {
        wallet.setAllowance(TokenAllowance(ORIGIN, totalLimit = 10))
        val p = open()
        val key = p.connect()
        server.reply = FakeServer.Reply("application/json",
            """{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5}}""".toByteArray())

        assertEquals("BYOKY_PROXY_RESPONSE_DONE", p.proxy(key, CHAT).last().getString("type"))
        assertEquals(12, wallet.tokenUsage(ORIGIN))

        val second = p.proxy(key, CHAT)
        assertEquals(429, second.single().getInt("status"))
        assertEquals("QUOTA_EXCEEDED", second.single().getJSONObject("error").getString("code"))
        assertEquals(1, server.requests.size)
    }

    // ── What the bridge accepts ──────────────────────────────────────────

    /** Request ids are page-supplied: anything but the SDK's shape gets no reply and goes nowhere. */
    @Test
    fun aMalformedRequestIdIsIgnored() {
        val p = open()
        val key = p.connect()
        for (id in listOf("a b", "x".repeat(200), "x',alert(1),'")) {
            val replies = p.send(JSONObject().put("type", "BYOKY_PROXY_REQUEST").put("requestId", id)
                .put("sessionKey", key).put("providerId", "ollama").put("url", "${server.base}/v1/chat/completions")
                .put("method", "POST").put("body", CHAT), timeoutMs = 1_000)
            assertTrue(id, replies.isEmpty())
        }
        assertTrue(server.requests.isEmpty())
    }

    /** A cross-origin iframe gets neither the native object nor the bridge, and its messages reach nothing. */
    @Test
    fun aCrossOriginIframeCantReachTheWallet() {
        val p = open(PAGE_WITH_FRAME)

        val frameSaw = p.awaitTestMessage("frame")
        assertEquals("undefined", frameSaw.getString("native"))
        assertEquals("undefined", frameSaw.getString("marker"))
        Thread.sleep(1_500)
        assertTrue(wallet.sessions.value.none { it.appOrigin == ORIGIN })
        assertTrue(server.requests.isEmpty())
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun text(replies: List<JSONObject>): String =
        replies.filter { it.getString("type") == "BYOKY_PROXY_RESPONSE_CHUNK" }.joinToString("") { it.getString("chunk") }

    private fun waitUntil(timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(20)
        }
        fail("timed out")
    }

    /** The app's page in a WebView on screen, wired as AppRuntimeScreen wires it. */
    private inner class BridgePage(wallet: WalletStore, private val html: String) : AutoCloseable {
        private val scenario = ActivityScenario.launch(ComponentActivity::class.java)
        private lateinit var webView: WebView
        private lateinit var bridge: AppBridge
        private val waiting = ConcurrentHashMap<String, CompletableFuture<JSONObject>>()
        @Volatile private var loaded = CountDownLatch(1)

        init {
            scenario.onActivity { activity ->
                webView = WebView(activity)
                webView.settings.javaScriptEnabled = true
                bridge = AppBridge(wallet, ProxyService(wallet, context), ORIGIN)
                WebViewCompat.addWebMessageListener(webView, AppBridge.JS_OBJECT_NAME, setOf(ORIGIN), bridge)
                WebViewCompat.addDocumentStartJavaScript(webView, AppBridge.BRIDGE_JS, setOf(ORIGIN))
                // The test's own channel back from the page.
                WebViewCompat.addWebMessageListener(webView, "__byokyTest", setOf(ORIGIN)) { _, message, _, _, _ ->
                    val result = JSONObject(message.data ?: return@addWebMessageListener)
                    waiting.computeIfAbsent(result.getString("id")) { CompletableFuture() }.complete(result)
                }
                webView.webViewClient = object : AppWebViewClient(
                    appOrigin = ORIGIN,
                    page = AppPageState(),
                    injectOnPageStart = false,
                    openExternally = {},
                    onLeftOrigin = { _, _ -> },
                    onPageReplaced = bridge::cancelInFlight,
                    onRendererGone = {},
                    onLoadStarted = {},
                    onLoadFailed = {},
                ) {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        val url = request.url
                        val document = when {
                            url.host == "app.example" && url.path == "/" -> html
                            url.host == "frame.example" -> FRAME
                            else -> return null
                        }
                        return WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(document.toByteArray()))
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        super.onPageFinished(view, url)
                        loaded.countDown()
                    }
                }
                activity.setContentView(webView)
                webView.loadUrl("$ORIGIN/")
            }
            assertTrue("the page loaded", loaded.await(15, TimeUnit.SECONDS))
        }

        fun reload() {
            loaded = CountDownLatch(1)
            scenario.onActivity { webView.reload() }
            assertTrue("the page reloaded", loaded.await(15, TimeUnit.SECONDS))
        }

        fun eval(script: String) {
            scenario.onActivity { webView.evaluateJavascript(script, null) }
        }

        /** Post [message] with a MessagePort, as the SDK does, and collect the replies until a terminal one or [timeoutMs]. */
        fun send(message: JSONObject, timeoutMs: Long = 5_000): List<JSONObject> = sendAsync(message, timeoutMs).get(timeoutMs + 10_000, TimeUnit.MILLISECONDS)

        private fun sendAsync(message: JSONObject, timeoutMs: Long): CompletableFuture<List<JSONObject>> {
            val id = UUID.randomUUID().toString()
            eval("window.__send(${JSONObject.quote(id)}, $message, $timeoutMs)")
            return CompletableFuture.supplyAsync {
                awaitTestMessage(id, timeoutMs + 10_000).getJSONArray("replies").let { arr -> List(arr.length()) { arr.getJSONObject(it) } }
            }
        }

        fun awaitTestMessage(id: String, timeoutMs: Long = 15_000): JSONObject =
            waiting.computeIfAbsent(id) { CompletableFuture() }.get(timeoutMs, TimeUnit.MILLISECONDS)

        /** Post [message] without waiting for replies. */
        fun post(message: JSONObject) {
            eval("window.postMessage($message, '*')")
            Thread.sleep(300)
        }

        fun connect(): String =
            send(JSONObject().put("type", "BYOKY_CONNECT_REQUEST").put("requestId", "connect-${UUID.randomUUID().toString().take(8)}")
                .put("payload", JSONObject()))
                .single().getJSONObject("payload").getString("sessionKey")

        fun status(key: String): Boolean =
            send(JSONObject().put("type", "BYOKY_SESSION_STATUS").put("requestId", "status-${UUID.randomUUID().toString().take(8)}")
                .put("payload", JSONObject().put("sessionKey", key)))
                .single().getJSONObject("payload").getBoolean("connected")

        private fun proxyMessage(key: String, body: String, requestId: String, providerId: String, url: String) = JSONObject()
            .put("type", "BYOKY_PROXY_REQUEST").put("requestId", requestId).put("sessionKey", key)
            .put("providerId", providerId).put("url", url).put("method", "POST")
            .put("headers", JSONObject().put("content-type", "application/json")).put("body", body)

        fun proxy(
            key: String,
            body: String,
            providerId: String = "ollama",
            url: String = "${server.base}/v1/chat/completions",
            requestId: String = "req-${UUID.randomUUID().toString().take(8)}",
        ): List<JSONObject> = send(proxyMessage(key, body, requestId, providerId, url), timeoutMs = 10_000)

        /**
         * A request whose replies are still being collected (3 s) while the
         * test goes on. A page replaced meanwhile never reports them: the
         * future then fails instead of the thread taking the process down.
         */
        fun proxyInBackground(key: String, requestId: String): CompletableFuture<List<JSONObject>> {
            val result = CompletableFuture<List<JSONObject>>()
            thread {
                try {
                    result.complete(send(proxyMessage(key, CHAT, requestId, "ollama", "${server.base}/v1/chat/completions"), timeoutMs = 3_000))
                } catch (e: Exception) {
                    result.completeExceptionally(e)
                }
            }
            return result
        }

        override fun close() {
            scenario.onActivity {
                bridge.dispose()
                webView.destroy()
            }
            scenario.close()
        }
    }

    private companion object {
        const val ORIGIN = "https://app.example"
        const val KEY = "sk-local-e2e-0123456789"
        const val CHAT = """{"model":"llama3.1","max_tokens":20000,"messages":[{"role":"user","content":"hi"}]}"""

        /** Sends a message as the SDK does and reports every reply on its port to the test. */
        const val SCRIPT = """
            window.__send = function (id, message, timeoutMs) {
              var channel = new MessageChannel();
              var replies = [];
              var terminal = { BYOKY_CONNECT_RESPONSE: 1, BYOKY_ERROR: 1, BYOKY_PROXY_RESPONSE_DONE: 1,
                BYOKY_PROXY_RESPONSE_ERROR: 1, BYOKY_SESSION_STATUS_RESPONSE: 1, BYOKY_SESSION_USAGE_RESPONSE: 1 };
              var done = false;
              function finish() {
                if (done) return;
                done = true;
                __byokyTest.postMessage(JSON.stringify({ id: id, replies: replies }));
              }
              var timer = setTimeout(finish, timeoutMs);
              channel.port1.onmessage = function (event) {
                replies.push(event.data);
                if (terminal[event.data.type]) { clearTimeout(timer); finish(); }
              };
              window.postMessage(message, '*', [channel.port2]);
            };
        """

        const val PAGE = "<!doctype html><html><head><script>$SCRIPT</script></head><body>app</body></html>"

        /** The app embeds another site, which tries to talk to the wallet. */
        const val PAGE_WITH_FRAME = """<!doctype html><html><head><script>$SCRIPT
            window.addEventListener('message', function (event) {
              if (event.data && event.data.frameSaw) __byokyTest.postMessage(JSON.stringify(Object.assign({ id: 'frame' }, event.data.frameSaw)));
            });
            </script></head><body>app<iframe src="https://frame.example/"></iframe></body></html>"""

        const val FRAME = """<!doctype html><html><body><script>
            var request = { type: 'BYOKY_CONNECT_REQUEST', requestId: 'frame1', payload: {} };
            window.postMessage(request, '*');
            parent.postMessage(request, '*');
            try { window.__byokyNative.postMessage(JSON.stringify(request)); } catch (e) {}
            parent.postMessage({ frameSaw: { native: typeof window.__byokyNative, marker: typeof window.__byoky__ } }, '*');
            </script></body></html>"""
    }
}
