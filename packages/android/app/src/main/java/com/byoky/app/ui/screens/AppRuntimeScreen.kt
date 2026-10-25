package com.byoky.app.ui.screens

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.ProxyService
import com.byoky.app.runtime.AppBridge
import com.byoky.app.ui.components.RetroTopBar
import com.byoky.app.ui.theme.*

/**
 * The in-wallet browser: opens an installed app in a WebView with the Byoky
 * bridge injected (see [AppBridge]). The page uses the wallet exactly as it
 * would use the browser extension on desktop; keys stay in this process.
 *
 * Navigation is pinned to the app's own origin. Links to other sites open in
 * the system browser, where the bridge is not available.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRuntimeScreen(wallet: WalletStore, appId: String, onClose: () -> Unit) {
    val apps by wallet.installedApps.collectAsState()
    val app = apps.firstOrNull { it.id == appId }
    val bridgeSupported = remember { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableIntStateOf(0) }

    BackHandler {
        val wv = webView
        if (wv != null && wv.canGoBack()) wv.goBack() else onClose()
    }

    Scaffold(
        topBar = {
            RetroTopBar(
                title = {
                    Column {
                        Text(
                            app?.name ?: "App",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (app != null) {
                            Text(
                                app.origin.removePrefix("https://"),
                                style = MonoStyle.copy(fontSize = 11.sp, lineHeight = 15.sp),
                                color = Phosphor,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Default.Close, contentDescription = "Close app")
                    }
                },
                actions = {
                    if (webView != null) {
                        IconButton(onClick = { webView?.reload() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Reload")
                        }
                    }
                },
            )
        },
        containerColor = Void,
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when {
                app == null -> RuntimeMessage("This app is no longer in your list.")
                !app.enabled -> RuntimeMessage("This app is disabled. Enable it from the Apps tab to open it.")
                !bridgeSupported -> RuntimeMessage(
                    "Your Android System WebView is too old to run apps inside the wallet. " +
                        "Update Android System WebView from the Play Store and try again."
                )
                else -> AppWebView(
                    wallet = wallet,
                    app = app,
                    onCreated = { webView = it },
                    onProgress = { progress = it },
                    onRendererGone = onClose,
                )
            }
            if (progress in 1..99) {
                LinearProgressIndicator(
                    progress = { progress / 100f },
                    modifier = Modifier.fillMaxWidth().height(2.dp).align(Alignment.TopCenter),
                    color = Violet,
                    trackColor = Seam,
                    strokeCap = StrokeCap.Butt,
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        }
    }
}

@Composable
private fun RuntimeMessage(text: String) {
    Box(modifier = Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, color = Fog, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
}

@SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
@Composable
private fun AppWebView(
    wallet: WalletStore,
    app: InstalledApp,
    onCreated: (WebView) -> Unit,
    onProgress: (Int) -> Unit,
    onRendererGone: () -> Unit,
) {
    val context = LocalContext.current
    val origin = app.origin
    val bridge = remember(app.id) {
        AppBridge(wallet, ProxyService(wallet, context.applicationContext), origin)
    }
    DisposableEffect(bridge) {
        onDispose { bridge.dispose() }
    }

    val openExternally: (Uri) -> Unit = { uri ->
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, uri)
                    .addCategory(Intent.CATEGORY_BROWSABLE)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: ActivityNotFoundException) {
            // No browser installed; ignore the link.
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.javaScriptCanOpenWindowsAutomatically = false
                settings.setSupportMultipleWindows(false)
                settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

                // The native object and the bootstrap script are both scoped
                // to the app's origin: other origins (iframes, or the page
                // after an off-origin redirect) get neither.
                WebViewCompat.addWebMessageListener(this, AppBridge.JS_OBJECT_NAME, setOf(origin), bridge)
                val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                if (documentStart) {
                    WebViewCompat.addDocumentStartJavaScript(this, AppBridge.BRIDGE_JS, setOf(origin))
                }

                webViewClient = AppWebViewClient(
                    appOrigin = origin,
                    injectOnPageStart = !documentStart,
                    openExternally = openExternally,
                    onRendererGone = onRendererGone,
                )
                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView, newProgress: Int) {
                        onProgress(newProgress)
                    }
                }
                loadUrl(app.url)
                onCreated(this)
            }
        },
        onRelease = { view ->
            view.stopLoading()
            view.destroy()
        },
    )
}

private class AppWebViewClient(
    private val appOrigin: String,
    private val injectOnPageStart: Boolean,
    private val openExternally: (Uri) -> Unit,
    private val onRendererGone: () -> Unit,
) : WebViewClient() {
    private var lastBlockedUrl: String? = null
    private var lastBlockedAt = 0L

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) return false
        val uri = request.url
        if (uri.scheme == "https" && AppBridge.originOf(uri) == appOrigin) return false
        if (uri.scheme == "https" || uri.scheme == "http") openExternally(uri)
        // Everything else (intent:, file:, javascript:, custom schemes) is blocked.
        return true
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        if (leaveIfOffOrigin(view, url)) return
        // Fallback for WebViews without document-start scripts. Racier (page
        // scripts may run first) but the SDK only looks for the wallet when
        // the app calls connect().
        if (injectOnPageStart && url != null && AppBridge.originOf(Uri.parse(url)) == appOrigin) {
            view.evaluateJavascript(AppBridge.BRIDGE_JS, null)
        }
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        super.doUpdateVisitedHistory(view, url, isReload)
        leaveIfOffOrigin(view, url)
    }

    /**
     * shouldOverrideUrlLoading isn't called for every navigation (form POSTs,
     * for one), so the main frame could otherwise land on another origin
     * while the title bar still names the app. When that happens, stop, hand
     * the URL to the system browser and put the app back.
     */
    private fun leaveIfOffOrigin(view: WebView, url: String?): Boolean {
        if (url == null) return false
        val uri = Uri.parse(url)
        if (uri.scheme == "about") return false
        if (uri.scheme == "https" && AppBridge.originOf(uri) == appOrigin) return false

        view.stopLoading()
        val now = System.currentTimeMillis()
        val repeat = url == lastBlockedUrl && now - lastBlockedAt < 2_000
        lastBlockedUrl = url
        lastBlockedAt = now
        if (!repeat && (uri.scheme == "https" || uri.scheme == "http")) openExternally(uri)
        // No app page to return to (the start URL itself left the origin):
        // show a blank page rather than reloading into the same redirect.
        if (view.canGoBack()) view.goBack() else view.loadUrl("about:blank")
        return true
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // Keep the wallet alive if the page's renderer dies; leave the app.
        onRendererGone()
        return true
    }
}
