package com.byoky.app.data

import android.app.Instrumentation
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Pages of an origin in a WebView like the in-wallet browser's, loaded without the network. */
internal class BrowserPages(private val instrumentation: Instrumentation) {

    /** A login cookie and localStorage for [origin], as an app would leave them. */
    fun store(origin: String, data: String) {
        val cookieSet = CountDownLatch(1)
        instrumentation.runOnMainSync {
            CookieManager.getInstance().setCookie(origin, "sid=owner; Max-Age=86400; Path=/; Secure") { cookieSet.countDown() }
        }
        assertTrue(cookieSet.await(10, TimeUnit.SECONDS))
        assertEquals("\"ok\"", evaluate(origin, "localStorage.setItem('chat', '$data'); 'ok'"))
    }

    /** What a page of [origin] sees: its localStorage entry and its cookies. */
    fun read(origin: String): String? =
        evaluate(origin, "(localStorage.getItem('chat') ?? 'null') + ' | ' + document.cookie")

    /** WebView deletes asynchronously: [read]s [origin] until it shows [expected], for a few seconds. */
    fun readUntil(origin: String, expected: String): String? {
        var last: String? = null
        repeat(40) {
            instrumentation.runOnMainSync {}
            last = read(origin)
            if (last == expected) return last
            Thread.sleep(250)
        }
        return last
    }

    private fun evaluate(origin: String, js: String): String? {
        val result = AtomicReference<String?>()
        val done = CountDownLatch(1)
        lateinit var webView: WebView
        instrumentation.runOnMainSync {
            webView = WebView(instrumentation.targetContext)
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String?) {
                    view.evaluateJavascript(js) { result.set(it); done.countDown() }
                }
            }
            webView.loadDataWithBaseURL("$origin/", "<html><body>app</body></html>", "text/html", "utf-8", null)
        }
        assertTrue("page didn't load", done.await(30, TimeUnit.SECONDS))
        instrumentation.runOnMainSync { webView.destroy() }
        return result.get()
    }

    companion object {
        /** What [read] shows once an origin's storage and cookies are gone. */
        const val NOTHING = "\"null | \""
    }
}
