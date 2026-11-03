package com.byoky.app.proxy

import android.content.Context
import android.net.Uri
import android.security.NetworkSecurityPolicy
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import com.byoky.app.runtime.AppBridge
import org.json.JSONObject
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.WalletStore
import kotlinx.coroutines.runBlocking
import okhttp3.Call
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/**
 * [ProxyService.forward] end to end against a local fake server (an Ollama
 * credential on http://127.0.0.1, a cleartext host the app allows):
 * which headers reach the upstream, binary replies, key decryption per
 * request, and the documented error codes. No network or real keys needed.
 */
@RunWith(AndroidJUnit4::class)
class ProxyServiceLocalFlowTest {
    private lateinit var context: Context
    private lateinit var wallet: WalletStore
    private lateinit var proxy: ProxyService
    private lateinit var server: FakeServer

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearWalletState()
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword("ProxyLocalFlowTest!long") }
        proxy = ProxyService(wallet, context)
        server = FakeServer()
        runBlocking { wallet.addCredential("ollama", "local", "sk-local-test-123", baseUrl = server.base) }
    }

    @After
    fun tearDown() {
        server.close()
        try { wallet.lock() } catch (_: Throwable) {}
        clearWalletState()
    }

    /** Only allow-listed headers reach the provider, plus the key (F091). */
    @Test
    fun onlyAllowedHeadersReachTheUpstream() {
        server.reply = FakeServer.Reply("application/json", """{"ok":true}""".toByteArray())
        forward(headers = mapOf(
            "Content-Type" to "application/json",
            "Cookie" to "session=from-page",
            "Origin" to "https://some-app.example",
            "X-Stainless-OS" to "Android",
            "X-Goog-User-Project" to "someone-elses-project",
            "X-HTTP-Method-Override" to "DELETE",
            "Accept-Encoding" to "identity",
        ))
        val headers = server.requests.single().headers
        assertEquals("application/json", headers["content-type"])
        assertEquals("Bearer sk-local-test-123", headers["authorization"])
        for (name in listOf("cookie", "origin", "x-stainless-os", "x-goog-user-project", "x-http-method-override")) {
            assertFalse("$name was forwarded", name in headers)
        }
    }

    /** A binary reply reaches the sink byte for byte (F026). */
    @Test
    fun binaryRepliesArriveIntact() {
        val audio = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x64) + ByteArray(256) { it.toByte() }
        server.reply = FakeServer.Reply("audio/mpeg", audio)
        val sink = forward()
        assertArrayEquals(audio, sink.bytes.toByteArray())
        assertEquals("", sink.text.toString())
        assertTrue(sink.done)
    }

    /** The key is decrypted once per unlock, not per request (F043). */
    @Test
    fun theKeyIsDecryptedOncePerUnlock() {
        server.reply = FakeServer.Reply("application/json", """{"ok":true}""".toByteArray())
        forward() // pays the one PBKDF2
        val started = System.nanoTime()
        forward()
        val ms = (System.nanoTime() - started) / 1_000_000
        // A 600k-iteration PBKDF2 takes most of a second on a phone.
        assertTrue("second request took $ms ms", ms < 400)
    }

    /** No key that can serve the request: PROVIDER_UNAVAILABLE, 403 (F103). */
    @Test
    fun noKeyIsProviderUnavailable() {
        try {
            proxy.forward("https://app.example", "mistral", "https://api.mistral.ai/v1/chat/completions", "POST",
                mapOf("content-type" to "application/json"), """{"model":"m","messages":[]}""".toByteArray(), CollectingSink())
            fail("expected an error")
        } catch (e: ProxyService.ProxyError) {
            assertEquals("PROVIDER_UNAVAILABLE", e.code)
            assertEquals(403, e.status)
        }
        assertTrue(server.requests.isEmpty())
    }

    /**
     * A local server on IPv6 loopback is reachable over plain http, as on
     * iOS and in the extension (R2-04): the network security config allows
     * cleartext to `::1`, and the credential's `[::1]` server matches the
     * request. LAN addresses stay HTTPS-only.
     */
    @Test
    fun anIpv6LoopbackServerIsReachable() {
        val policy = NetworkSecurityPolicy.getInstance()
        assertTrue("cleartext to ::1", policy.isCleartextTrafficPermitted("::1"))
        assertTrue(policy.isCleartextTrafficPermitted("127.0.0.1"))
        assertFalse(policy.isCleartextTrafficPermitted("192.168.1.5"))
        assertFalse(policy.isCleartextTrafficPermitted("::2"))

        FakeServer(host = "::1").use { v6 ->
            v6.reply = FakeServer.Reply("application/json", """{"ok":"v6"}""".toByteArray())
            runBlocking { wallet.addCredential("lm_studio", "v6", "sk-v6-test", baseUrl = v6.base) }
            val sink = CollectingSink()
            proxy.forward("https://app.example", "lm_studio", "${v6.base}/v1/chat/completions", "POST",
                mapOf("content-type" to "application/json"), """{"model":"qwen","messages":[]}""".toByteArray(), sink)
            assertEquals("""{"ok":"v6"}""", sink.text.toString())
            assertTrue(sink.done)
            assertEquals(1, v6.requests.size)
        }
    }

    /**
     * A group pinning another model of the app's family gets that model's
     * request rules (R3-05). Here an OpenAI reasoning model's id on the local
     * server: its sampling overrides go; max_tokens stays, since only OpenAI's
     * own API wants max_completion_tokens.
     */
    @Test
    fun aPinnedModelGetsItsRequestRules() {
        val group = wallet.createGroup("Pinned", "ollama", model = "gpt-5.5")
        wallet.setAppGroup("https://app.example", group.id)
        server.reply = FakeServer.Reply("application/json", """{"ok":true}""".toByteArray())
        proxy.forward("https://app.example", "ollama", "${server.base}/v1/chat/completions", "POST",
            mapOf("content-type" to "application/json"),
            """{"model":"llama3.1","max_tokens":64,"temperature":0.5,"messages":[]}""".toByteArray(), CollectingSink())
        val sent = JSONObject(String(server.requests.single().body))
        assertEquals("gpt-5.5", sent.getString("model"))
        assertEquals(64, sent.getInt("max_tokens"))
        assertFalse(sent.has("temperature"))
    }

    /** A body that isn't JSON keeps its bytes under a pinned model. */
    @Test
    fun aPinnedModelLeavesABinaryBodyIntact() {
        val group = wallet.createGroup("Pinned", "ollama", model = "gpt-5.5")
        wallet.setAppGroup("https://app.example", group.id)
        server.reply = FakeServer.Reply("application/json", """{"ok":true}""".toByteArray())
        val bytes = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0x00, 0x7B) + ByteArray(256) { it.toByte() }
        proxy.forward("https://app.example", "ollama", "${server.base}/v1/chat/completions", "POST",
            mapOf("content-type" to "application/octet-stream"), bytes, CollectingSink())
        assertArrayEquals(bytes, server.requests.single().body)
    }

    /**
     * A request that names no model (a model list, a multipart upload) from
     * an app its group routes to another provider is refused, as by the
     * extension and iOS, and never sent on the key the group routes it away
     * from (F041). Here the app asks for the local server and its group
     * routes it to Anthropic.
     */
    @Test
    fun groupRoutedRequestsWithoutAModelAreRefused() {
        runBlocking { wallet.addCredential("anthropic", "claude", "sk-ant-api03-local-flow-test") }
        val group = wallet.createGroup("Claude", "anthropic", model = "claude-sonnet-4-6")
        wallet.setAppGroup("https://app.example", group.id)
        fun assertRefused(send: () -> Unit) {
            try {
                send()
                fail("expected ROUTING_UNSUPPORTED")
            } catch (e: ProxyService.ProxyError) {
                assertEquals("ROUTING_UNSUPPORTED", e.code)
                assertEquals(400, e.status)
            }
        }
        assertRefused {
            proxy.forward("https://app.example", "ollama", "${server.base}/v1/models", "GET", emptyMap(), null, CollectingSink())
        }
        assertRefused {
            proxy.forward("https://app.example", "ollama", "${server.base}/v1/audio/transcriptions", "POST",
                mapOf("content-type" to "multipart/form-data; boundary=x"),
                "--x\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper\r\n--x--\r\n".toByteArray(),
                CollectingSink(), binaryBody = true)
        }
        assertTrue("sent upstream: ${server.requests.map { it.line }}", server.requests.isEmpty())
    }

    /**
     * A translated request's error body past the translation limit goes to
     * the app as it arrives, as sent, instead of first being read whole into
     * memory (R2-05).
     */
    @Test
    fun anOversizedTranslatedErrorIsPassedOnAsItArrives() {
        val group = wallet.createGroup("Local", "ollama", model = "llama3.1")
        wallet.setAppGroup("https://app.example", group.id)
        val limit = ProxyService.MAX_TRANSLATED_ERROR_CHARS
        val error = "{\"error\":{\"type\":\"invalid_request_error\",\"message\":\"" +
            "a".repeat(limit + 100_000) + "é".repeat(1_000) + "\"}}"
        server.reply = FakeServer.Reply("application/json", error.toByteArray(), status = 400)
        val sink = CollectingSink()
        proxy.forward("https://app.example", "anthropic", "https://api.anthropic.com/v1/messages", "POST",
            mapOf("content-type" to "application/json"),
            """{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}""".toByteArray(), sink)
        assertTrue(server.requests.single().line.startsWith("POST /v1/chat/completions"))
        assertEquals(error, sink.text.toString())
        assertTrue("delivered in ${sink.chunks.size} chunk(s)", sink.chunks.size > 1)
        assertTrue("first chunk ${sink.chunks.first().length}", sink.chunks.first().length <= limit + 8_192)
        assertTrue(sink.done)
    }

    /**
     * A 20 MB upload doesn't block the main thread: the bridge hands the
     * message off at once, and a cancel right after still stops it before
     * anything is sent (F107).
     */
    @Test
    fun largeUploadsLeaveTheMainThreadAlone() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val replies = CopyOnWriteArrayList<JSONObject>()
        val reply = object : JavaScriptReplyProxy() {
            override fun postMessage(message: String) { replies += JSONObject(message) }
            override fun postMessage(message: ByteArray) {}
        }
        lateinit var webView: WebView
        lateinit var bridge: AppBridge
        val origin = Uri.parse("https://app.example")
        instrumentation.runOnMainSync {
            webView = WebView(context)
            bridge = AppBridge(wallet, proxy, "https://app.example")
        }
        fun post(message: JSONObject): Long {
            // As the page sends it: one JSON string, built before the timer starts.
            val webMessage = WebMessageCompat(message.toString())
            var ms = 0L
            instrumentation.runOnMainSync {
                val started = System.nanoTime()
                bridge.onPostMessage(webView, webMessage, origin, true, reply)
                ms = (System.nanoTime() - started) / 1_000_000
            }
            return ms
        }
        try {
            post(JSONObject().put("type", "BYOKY_CONNECT_REQUEST").put("requestId", "connect1").put("payload", JSONObject()))
            val sessionKey = waitFor { replies.firstOrNull { it.optString("type") == "BYOKY_CONNECT_RESPONSE" } }
                .getJSONObject("payload").getString("sessionKey")

            val upload = android.util.Base64.encodeToString(ByteArray(15 * 1024 * 1024), android.util.Base64.NO_WRAP)
            val message = JSONObject()
                .put("type", "BYOKY_PROXY_REQUEST").put("requestId", "upload1").put("sessionKey", sessionKey)
                .put("providerId", "ollama").put("url", "${server.base}/v1/chat/completions").put("method", "POST")
                .put("headers", JSONObject().put("content-type", "application/octet-stream"))
                .put("body", upload).put("bodyEncoding", "base64")
            val ms = post(message)
            post(JSONObject().put("type", "BYOKY_PROXY_CANCEL").put("requestId", "upload1"))

            assertTrue("onPostMessage blocked the main thread for $ms ms", ms < 50)
            Thread.sleep(3_000)
            assertTrue("the cancelled upload was sent", server.requests.isEmpty())
            assertFalse(replies.any { it.optString("requestId") == "upload1" && it.optString("type") == "BYOKY_PROXY_RESPONSE_DONE" })
        } finally {
            instrumentation.runOnMainSync {
                bridge.dispose()
                webView.destroy()
            }
        }
    }

    private fun <T : Any> waitFor(timeoutMs: Long = 10_000, probe: () -> T?): T {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            probe()?.let { return it }
            Thread.sleep(20)
        }
        fail("timed out")
        throw AssertionError()
    }

    private fun forward(headers: Map<String, String> = mapOf("content-type" to "application/json")): CollectingSink {
        val sink = CollectingSink()
        proxy.forward("https://app.example", "ollama", "${server.base}/v1/chat/completions", "POST",
            headers, """{"model":"llama3.1","messages":[]}""".toByteArray(), sink)
        return sink
    }

    private class CollectingSink : ProxyService.ResponseSink {
        val text = StringBuilder()
        val chunks = mutableListOf<String>()
        val bytes = ByteArrayOutputStream()
        var done = false
        override fun onCall(call: Call) {}
        override fun onMeta(status: Int, statusText: String, headers: Map<String, String>) {}
        override fun onChunk(chunk: String) { text.append(chunk); chunks += chunk }
        override fun onBytes(chunk: ByteArray) { bytes.write(chunk) }
        override fun onDone() { done = true }
    }

    private fun clearWalletState() {
        context.getSharedPreferences("byoky_state", Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }

    /** One-connection-per-request HTTP/1.1 server on [host] (127.0.0.1 unless given). */
    private class FakeServer(host: String = "127.0.0.1") : AutoCloseable {
        data class Request(val line: String, val headers: Map<String, String>, val body: ByteArray)
        data class Reply(val contentType: String, val body: ByteArray, val status: Int = 200)

        @Volatile var reply = Reply("application/json", "{}".toByteArray())
        val requests = CopyOnWriteArrayList<Request>()
        private val socket = ServerSocket(0, 16, InetAddress.getByName(host))
        val base = "http://${if (':' in host) "[$host]" else host}:${socket.localPort}"

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = try { socket.accept() } catch (_: Exception) { break }
                    client.use { c ->
                        val input = BufferedInputStream(c.getInputStream())
                        val line = readLine(input)
                        val headers = mutableMapOf<String, String>()
                        while (true) {
                            val h = readLine(input)
                            if (h.isEmpty()) break
                            val i = h.indexOf(':')
                            if (i > 0) headers[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
                        }
                        val length = headers["content-length"]?.toIntOrNull() ?: 0
                        val body = ByteArray(length)
                        var read = 0
                        while (read < length) {
                            val n = input.read(body, read, length - read)
                            if (n < 0) break
                            read += n
                        }
                        requests += Request(line, headers, body)
                        val r = reply
                        val out = c.getOutputStream()
                        out.write(("HTTP/1.1 ${r.status} OK\r\nContent-Type: ${r.contentType}\r\n" +
                            "Content-Length: ${r.body.size}\r\nConnection: close\r\n\r\n").toByteArray())
                        out.write(r.body)
                        out.flush()
                    }
                }
            }
        }

        private fun readLine(input: BufferedInputStream): String {
            val sb = StringBuilder()
            while (true) {
                val b = input.read()
                if (b < 0 || b == '\n'.code) break
                if (b != '\r'.code) sb.append(b.toChar())
            }
            return sb.toString()
        }

        override fun close() = socket.close()
    }
}
