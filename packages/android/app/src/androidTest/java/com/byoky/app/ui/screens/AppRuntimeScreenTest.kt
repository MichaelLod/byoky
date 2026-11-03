package com.byoky.app.ui.screens

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.WalletStore
import com.byoky.app.testing.clearWalletState
import kotlinx.coroutines.runBlocking
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLSocket
import kotlin.concurrent.thread

/** The in-wallet browser's own states: a certificate error (F048) and a page leaving the app's origin (F049). */
@RunWith(AndroidJUnit4::class)
class AppRuntimeScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private lateinit var wallet: WalletStore

    @Before
    fun setup() {
        clearWalletState(context)
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword("AppRuntimeScreenTest!long") }
    }

    @After
    fun tearDown() {
        try { wallet.lock() } catch (_: Throwable) {}
        clearWalletState(context)
    }

    /**
     * An app whose certificate isn't valid (expired, a captive portal, TLS
     * interception) says so and offers Retry, instead of a blank screen; Retry
     * tries the site again (F048). The local server's certificate is
     * self-signed, so WebView never trusts it.
     */
    @Test
    fun aCertificateErrorShowsWhyAndRetryTriesAgain() {
        SelfSignedServer().use { server ->
            val app = (wallet.addAppByUrl("https://localhost:${server.port}/") as WalletStore.AddAppResult.Added).app
            compose.setContent { AppRuntimeScreen(wallet, app.id) {} }

            compose.waitUntil(30_000) { insecureShown() }
            assertTrue(compose.onAllNodesWithText("Can't reach", substring = true).fetchSemanticsNodes().isEmpty())
            val attempts = server.connections.get()
            assertTrue("the browser never connected", attempts > 0)

            compose.onNodeWithContentDescription("Retry").performClick()
            compose.waitUntil(30_000) { server.connections.get() > attempts && insecureShown() }
        }
    }

    private fun insecureShown() =
        compose.onAllNodesWithText("connection isn't secure", substring = true).fetchSemanticsNodes().isNotEmpty()

    /** A script on the app's page sends it to another site: the wallet stops it and says so; no browser opens (F049). */
    @Test
    fun aPageSendingItselfElsewhereIsStoppedWithANotice() {
        WebViewHarness().use { h ->
            h.load("https://app.example/")
            h.eval("location.href = 'https://www.app.example/'")

            val (target, beforeFirstPage) = h.leftOrigin.poll()
            assertEquals("www.app.example", target.host)
            assertEquals(false, beforeFirstPage)
            assertTrue("opened the system browser", h.openedExternally.isEmpty())
            assertEquals("https://app.example/", h.url())
        }
    }

    /** The app's start page lands on another origin: the notice says nothing of the app loaded yet; no browser opens (F049). */
    @Test
    fun aStartPageOnAnotherOriginIsStoppedBeforeTheFirstPage() {
        WebViewHarness().use { h ->
            h.load("https://www.app.example/", awaitFinish = false)

            val (target, beforeFirstPage) = h.leftOrigin.poll()
            assertEquals("www.app.example", target.host)
            assertEquals(true, beforeFirstPage)
            assertTrue("opened the system browser", h.openedExternally.isEmpty())
        }
    }

    /** A WebView with the in-wallet browser's client, serving app.example and www.app.example itself. */
    private class WebViewHarness : AutoCloseable {
        private val scenario = ActivityScenario.launch(ComponentActivity::class.java)
        private lateinit var webView: WebView
        val leftOrigin = Events<Pair<Uri, Boolean>>()
        val openedExternally = CopyOnWriteArrayList<Uri>()
        @Volatile private var finished = CountDownLatch(1)

        init {
            scenario.onActivity { activity ->
                webView = WebView(activity)
                webView.settings.javaScriptEnabled = true
                webView.webViewClient = object : AppWebViewClient(
                    appOrigin = "https://app.example",
                    page = AppPageState(),
                    injectOnPageStart = false,
                    openExternally = { openedExternally += it },
                    onLeftOrigin = { uri, before -> leftOrigin.add(uri to before) },
                    onPageReplaced = {},
                    onRendererGone = {},
                    onLoadStarted = {},
                    onLoadFailed = {},
                ) {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        if (request.url.host?.endsWith("app.example") != true) return null
                        val html = "<!doctype html><html><body>${request.url.host}</body></html>"
                        return WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(html.toByteArray()))
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        super.onPageFinished(view, url)
                        finished.countDown()
                    }
                }
                activity.setContentView(webView)
            }
        }

        fun load(url: String, awaitFinish: Boolean = true) {
            finished = CountDownLatch(1)
            scenario.onActivity { webView.loadUrl(url) }
            if (awaitFinish) assertTrue("loaded $url", finished.await(15, TimeUnit.SECONDS))
        }

        fun eval(script: String) {
            scenario.onActivity { webView.evaluateJavascript(script, null) }
        }

        fun url(): String? {
            var url: String? = null
            scenario.onActivity { url = webView.url }
            return url
        }

        override fun close() {
            scenario.onActivity { webView.destroy() }
            scenario.close()
        }
    }

    /** Callback events, awaited one at a time. */
    private class Events<T> {
        private val queue = java.util.concurrent.LinkedBlockingQueue<T>()
        fun add(event: T) = queue.add(event)
        fun poll(timeoutMs: Long = 10_000): T = queue.poll(timeoutMs, TimeUnit.MILLISECONDS) ?: throw AssertionError("no event")
    }

    /** A TLS server on localhost whose certificate no one trusts. It counts connection attempts and serves nothing. */
    private class SelfSignedServer : AutoCloseable {
        private val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        private val socket: ServerSocket = HandshakeCertificates.Builder().heldCertificate(certificate).build()
            .sslContext().serverSocketFactory.createServerSocket(0)
        val port = socket.localPort
        val connections = AtomicInteger()

        init {
            thread(isDaemon = true) {
                while (!socket.isClosed) {
                    val client = try { socket.accept() } catch (_: Exception) { break }
                    connections.incrementAndGet()
                    thread(isDaemon = true) {
                        try {
                            client.use { (it as SSLSocket).startHandshake() }
                        } catch (_: Exception) {
                            // The browser refuses the certificate.
                        }
                    }
                }
            }
        }

        override fun close() = socket.close()
    }
}
