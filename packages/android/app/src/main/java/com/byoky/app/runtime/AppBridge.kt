package com.byoky.app.runtime

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.ProxyService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.Call
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Native side of the in-wallet browser bridge. It plays the role the browser
 * extension's content script + background worker play on desktop: a page
 * using `@byoky/sdk` posts `BYOKY_*` messages on `window`, the injected
 * script ([BRIDGE_JS]) forwards them here, and responses go back over the
 * page's MessagePorts. Keys never enter the WebView; [ProxyService] attaches
 * them to the upstream request.
 *
 * Transport is `WebViewCompat.addWebMessageListener`, which only exposes the
 * native object to frames whose origin matches the app's origin. Messages
 * from subframes or any other origin are ignored as well.
 *
 * One instance per opened app (per WebView). Call [dispose] when the WebView
 * goes away; in-flight requests are aborted.
 */
class AppBridge(
    private val wallet: WalletStore,
    private val proxy: ProxyService,
    /** `https://host[:port]` of the app (see `AppUrl`). */
    val appOrigin: String,
) : WebViewCompat.WebMessageListener {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var disposed = false

    /** Issued on BYOKY_CONNECT_REQUEST. Main thread only. */
    private var sessionKey: String? = null

    /** Proxy requests still running, by request id, so the app can cancel them. */
    private val inFlight = ConcurrentHashMap<String, InFlight>()

    private class InFlight {
        @Volatile var call: Call? = null
        @Volatile var cancelled = false

        /** Abort the upstream call; usage up to here still counts (ProxyService). */
        fun cancel() {
            cancelled = true
            call?.cancel()
        }
    }

    override fun onPostMessage(
        view: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy,
    ) {
        // Every message type passes these two checks: main frame of the app's
        // own origin only. (The native object is only injected there anyway.)
        if (disposed || !isMainFrame) return
        if (originOf(sourceOrigin) != appOrigin) return
        val raw = message.data ?: return
        val msg = try { JSONObject(raw) } catch (_: Exception) { return }
        val type = msg.optString("type")
        val requestId = msg.optString("requestId", "")
        // The SDK uses crypto.randomUUID(); anything else is not ours. Ids are
        // only ever echoed inside JSON over the reply channel, never spliced
        // into script source, but are validated all the same.
        if (type != "BYOKY_DISCONNECT" && !REQUEST_ID.matches(requestId)) return

        when (type) {
            "BYOKY_CONNECT_REQUEST" -> handleConnect(requestId, replyProxy)
            "BYOKY_PROXY_REQUEST" -> handleProxy(msg, requestId, replyProxy)
            "BYOKY_PROXY_CANCEL" -> inFlight[requestId]?.cancel()
            "BYOKY_SESSION_STATUS" -> handleSessionStatus(requestId, msg, replyProxy)
            "BYOKY_SESSION_USAGE" -> handleSessionUsage(requestId, msg, replyProxy)
            "BYOKY_DISCONNECT" -> handleDisconnect(msg)
        }
    }

    fun dispose() {
        disposed = true
        // Stop upstream transfers now rather than at their next chunk.
        inFlight.values.forEach { it.cancel() }
        scope.cancel()
    }

    // ── Connect ──────────────────────────────────────────────────────────

    private fun handleConnect(requestId: String, reply: JavaScriptReplyProxy) {
        if (!wallet.isUnlocked) {
            deliverConnectError(reply, requestId, "Wallet is locked")
            return
        }
        if (wallet.isOriginBlocked(appOrigin)) {
            // Revoked in the Connected tab: no silent reconnect. Reopening the
            // app from the Apps tab lifts this.
            deliverConnectError(reply, requestId, "Access for this app was revoked. Close it and open it again from your wallet's Apps tab to reconnect.")
            return
        }

        // The user opened this app from their wallet, so connecting is
        // implicit (same as the iOS in-wallet browser). Every provider the
        // wallet holds a key for is offered; routing can still serve other
        // providers through groups or translation.
        val credentials = wallet.credentials.value
        val providers = JSONObject()
        for (credential in credentials) {
            if (providers.has(credential.providerId)) continue
            providers.put(credential.providerId, JSONObject()
                .put("available", true)
                .put("authMethod", if (credential.authMethod == AuthMethod.OAUTH) "oauth" else "api_key"))
        }

        val key = "app_" + UUID.randomUUID().toString().replace("-", "")
        sessionKey = key
        wallet.upsertSession(appOrigin, credentials.map { it.providerId }.distinct())

        deliver(reply, JSONObject()
            .put("type", "BYOKY_CONNECT_RESPONSE")
            .put("requestId", requestId)
            .put("payload", JSONObject()
                .put("sessionKey", key)
                .put("providers", providers)
                .put("proxyUrl", "")))
    }

    private fun deliverConnectError(reply: JavaScriptReplyProxy, requestId: String, message: String) {
        deliver(reply, JSONObject()
            .put("type", "BYOKY_ERROR")
            .put("requestId", requestId)
            .put("payload", JSONObject()
                .put("code", "USER_REJECTED")
                .put("message", message)))
    }

    /**
     * The app disconnected itself: forget its key and end its stored session
     * (it leaves the Connected tab), as the extension does. Unlike a revoke
     * by the user, the app may connect again.
     */
    private fun handleDisconnect(msg: JSONObject) {
        val key = sessionKey ?: return
        val presented = msg.optString("sessionKey", "").ifEmpty {
            msg.optJSONObject("payload")?.optString("sessionKey", "") ?: ""
        }
        if (presented != key) return
        sessionKey = null
        wallet.endSession(appOrigin)
    }

    /** True while this page holds the current key and the user hasn't revoked the app. */
    private fun isSessionLive(presentedKey: String): Boolean {
        val key = sessionKey ?: return false
        if (presentedKey != key) return false
        if (!wallet.isUnlocked) return false
        if (wallet.isOriginBlocked(appOrigin)) {
            sessionKey = null
            return false
        }
        if (wallet.sessions.value.none { it.appOrigin == appOrigin && !it.isExpired }) {
            // Revoked from the Connected tab: force the app to reconnect.
            sessionKey = null
            return false
        }
        return true
    }

    // ── Proxy ────────────────────────────────────────────────────────────

    private fun handleProxy(msg: JSONObject, requestId: String, reply: JavaScriptReplyProxy) {
        if (requestId.isEmpty()) return
        if (!isSessionLive(msg.optString("sessionKey", ""))) {
            deliverProxyError(reply, requestId, "SESSION_EXPIRED", "Not connected to the wallet. Reconnect and try again.", 401)
            return
        }

        val providerId = msg.optString("providerId", "")
        val url = msg.optString("url", "")
        val method = msg.optString("method", "").ifEmpty { "GET" }
        if (providerId.isEmpty() || url.isEmpty()) {
            deliverProxyError(reply, requestId, "PROXY_ERROR", "Malformed proxy request", 400)
            return
        }

        val headers = mutableMapOf<String, String>()
        msg.optJSONObject("headers")?.let { h ->
            for (name in h.keys()) headers[name] = h.optString(name, "")
        }

        val bodyText = if (msg.isNull("body")) null else msg.optString("body", "")
        val encoding = msg.optString("bodyEncoding", "")
        val body: ByteArray? = when (encoding) {
            "base64" -> try {
                bodyText?.let { Base64.decode(it, Base64.DEFAULT) }
            } catch (_: IllegalArgumentException) {
                deliverProxyError(reply, requestId, "PROXY_ERROR", "Invalid base64 body", 400)
                return
            }
            "formdata" -> {
                val form = try {
                    FormDataBody.encode(bodyText ?: "[]")
                } catch (_: IllegalArgumentException) {
                    deliverProxyError(reply, requestId, "PROXY_ERROR", "Invalid form data body", 400)
                    return
                }
                // The multipart boundary is ours; drop any content type the app set.
                headers.keys.filter { it.equals("content-type", ignoreCase = true) }.forEach { headers.remove(it) }
                headers["content-type"] = form.contentType
                form.bytes
            }
            else -> bodyText?.toByteArray(Charsets.UTF_8)
        }
        val binaryBody = encoding == "base64" || encoding == "formdata"

        val flight = InFlight()
        inFlight[requestId] = flight
        scope.launch {
            val sink = object : ProxyService.ResponseSink {
                override fun onCall(call: Call) {
                    flight.call = call
                    if (flight.cancelled) call.cancel()
                }

                override fun onMeta(status: Int, statusText: String, headers: Map<String, String>) {
                    ensureActive(flight)
                    deliver(reply, JSONObject()
                        .put("type", "BYOKY_PROXY_RESPONSE_META")
                        .put("requestId", requestId)
                        .put("status", status)
                        .put("statusText", statusText)
                        .put("headers", JSONObject(headers as Map<*, *>)))
                }

                override fun onChunk(chunk: String) {
                    ensureActive(flight)
                    deliver(reply, JSONObject()
                        .put("type", "BYOKY_PROXY_RESPONSE_CHUNK")
                        .put("requestId", requestId)
                        .put("chunk", chunk))
                }

                override fun onDone() {
                    deliver(reply, JSONObject()
                        .put("type", "BYOKY_PROXY_RESPONSE_DONE")
                        .put("requestId", requestId))
                }
            }

            try {
                proxy.forward(appOrigin, providerId, url, method, headers, body, sink, binaryBody)
            } catch (e: CancellationException) {
                // WebView closed; nothing left to deliver to.
            } catch (e: Exception) {
                // Cancelled by the app: it stopped listening.
                if (!flight.cancelled) {
                    // Fixed codes and texts only: exception messages can quote headers (the key).
                    val error = PageError.from(e)
                    deliverProxyError(reply, requestId, error.code, error.message, error.status)
                }
            } finally {
                inFlight.remove(requestId, flight)
            }
        }
    }

    private fun ensureActive(flight: InFlight) {
        if (disposed) throw CancellationException("App closed")
        if (flight.cancelled) throw CancellationException("Cancelled by the app")
    }

    // ── Session status / usage ───────────────────────────────────────────

    private fun handleSessionStatus(requestId: String, msg: JSONObject, reply: JavaScriptReplyProxy) {
        val presented = msg.optJSONObject("payload")?.optString("sessionKey", "") ?: ""
        deliver(reply, JSONObject()
            .put("type", "BYOKY_SESSION_STATUS_RESPONSE")
            .put("requestId", requestId)
            .put("payload", JSONObject().put("connected", isSessionLive(presented))))
    }

    private fun handleSessionUsage(requestId: String, msg: JSONObject, reply: JavaScriptReplyProxy) {
        val presented = msg.optJSONObject("payload")?.optString("sessionKey", "") ?: ""
        val payload: Any = if (isSessionLive(presented)) {
            // The running totals allowances are enforced against, not the capped display log.
            val total = wallet.usageTotal(appOrigin)
            val providersJson = JSONObject()
            for ((id, usage) in wallet.usageByProvider(appOrigin)) {
                providersJson.put(id, JSONObject()
                    .put("requests", usage.requests)
                    .put("inputTokens", usage.inputTokens)
                    .put("outputTokens", usage.outputTokens))
            }
            JSONObject()
                .put("requests", total.requests)
                .put("inputTokens", total.inputTokens)
                .put("outputTokens", total.outputTokens)
                .put("byProvider", providersJson)
        } else JSONObject.NULL
        deliver(reply, JSONObject()
            .put("type", "BYOKY_SESSION_USAGE_RESPONSE")
            .put("requestId", requestId)
            .put("payload", payload))
    }

    // ── Delivery ─────────────────────────────────────────────────────────

    private fun deliverProxyError(reply: JavaScriptReplyProxy, requestId: String, code: String, message: String, status: Int) {
        deliver(reply, JSONObject()
            .put("type", "BYOKY_PROXY_RESPONSE_ERROR")
            .put("requestId", requestId)
            .put("status", status)
            .put("error", JSONObject().put("code", code).put("message", message)))
    }

    /** Reply proxies must be used on the main thread. */
    private fun deliver(reply: JavaScriptReplyProxy, message: JSONObject) {
        val text = message.toString()
        mainHandler.post {
            if (disposed) return@post
            try { reply.postMessage(text) } catch (_: Exception) { /* page navigated away */ }
        }
    }

    companion object {
        /** Name of the native object exposed to the app's main frame. */
        const val JS_OBJECT_NAME = "__byokyNative"

        private val REQUEST_ID = Regex("^[A-Za-z0-9_-]{1,128}$")

        /** `https://host[:port]` for a WebView-reported source origin. */
        fun originOf(uri: Uri): String? {
            val scheme = uri.scheme?.lowercase() ?: return null
            val host = uri.host?.lowercase() ?: return null
            val port = uri.port
            val defaultPort = if (scheme == "https") 443 else if (scheme == "http") 80 else -1
            return "$scheme://$host" + if (port != -1 && port != defaultPort) ":$port" else ""
        }

        /**
         * Injected at document start into the app's origin only. Marks the
         * page as having a Byoky wallet (`window.__byoky__`, which the SDK
         * checks), forwards `BYOKY_*` window messages to the native object and
         * routes replies back to the MessagePort each request came with.
         */
        val BRIDGE_JS = """
            (function () {
              if (window.__byokyBridgeInstalled) return;
              var native = window.$JS_OBJECT_NAME;
              if (!native) return;
              window.__byokyBridgeInstalled = true;
              window.__byoky__ = true;
              // No prototype: a page-chosen id like "__proto__" is just a key.
              var pending = Object.create(null);
              var idOk = /^[A-Za-z0-9_-]{1,128}$/;
              var notifyPorts = [];
              var terminal = {
                BYOKY_CONNECT_RESPONSE: 1, BYOKY_ERROR: 1,
                BYOKY_PROXY_RESPONSE_DONE: 1, BYOKY_PROXY_RESPONSE_ERROR: 1,
                BYOKY_SESSION_STATUS_RESPONSE: 1, BYOKY_SESSION_USAGE_RESPONSE: 1
              };
              native.onmessage = function (event) {
                var msg;
                try { msg = JSON.parse(event.data); } catch (e) { return; }
                if (!msg || typeof msg.type !== 'string') return;
                if (msg.type === 'BYOKY_SESSION_REVOKED' || msg.type === 'BYOKY_PROVIDERS_UPDATED') {
                  notifyPorts.forEach(function (p) { try { p.postMessage(msg); } catch (e) {} });
                  return;
                }
                if (typeof msg.requestId !== 'string' || !idOk.test(msg.requestId)) return;
                var port = pending[msg.requestId];
                if (!port) return;
                port.postMessage(msg);
                if (terminal[msg.type]) delete pending[msg.requestId];
              };
              window.addEventListener('message', function (event) {
                if (event.source !== window) return;
                var data = event.data;
                if (!data || typeof data.type !== 'string' || data.type.indexOf('BYOKY_') !== 0) return;
                var port = event.ports && event.ports[0];
                if (data.type === 'BYOKY_REGISTER_NOTIFY') {
                  if (port) notifyPorts.push(port);
                  return;
                }
                var requestId = data.requestId || data.id || '';
                if (typeof requestId !== 'string') return;
                if (data.type !== 'BYOKY_DISCONNECT' && !idOk.test(requestId)) return;
                // The app aborted the request: it no longer listens on that port.
                if (data.type === 'BYOKY_PROXY_CANCEL') delete pending[requestId];
                else if (port && requestId) pending[requestId] = port;
                var payload = data.payload || null;
                try {
                  native.postMessage(JSON.stringify({
                    type: data.type,
                    requestId: requestId,
                    payload: payload,
                    sessionKey: data.sessionKey || (payload && payload.sessionKey) || '',
                    providerId: data.providerId || '',
                    url: data.url || '',
                    method: data.method || '',
                    headers: data.headers || {},
                    body: typeof data.body === 'string' ? data.body : null,
                    bodyEncoding: data.bodyEncoding || null
                  }));
                } catch (e) {
                  console.error('[byoky] bridge forward failed', e);
                }
              });
            })();
        """.trimIndent()
    }
}
