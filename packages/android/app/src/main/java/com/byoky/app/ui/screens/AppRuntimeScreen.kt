package com.byoky.app.ui.screens

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.toArgb
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
import com.byoky.app.ui.components.BracketAction
import com.byoky.app.ui.components.GhostButton
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RetroTopBar
import com.byoky.app.ui.theme.*

/**
 * The in-wallet browser: opens an installed app in a WebView with the Byoky
 * bridge injected (see [AppBridge]). The page uses the wallet exactly as it
 * would use the browser extension on desktop; keys stay in this process.
 *
 * Navigation is pinned to the app's own origin. A link the user taps to
 * another site opens in the system browser, where the bridge is not
 * available; a page that sends itself elsewhere (a server redirect, a script,
 * a form) is stopped with a notice that offers the browser instead.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRuntimeScreen(wallet: WalletStore, appId: String, onClose: () -> Unit) {
    val apps by wallet.installedApps.collectAsState()
    val app = apps.firstOrNull { it.id == appId }
    val bridgeSupported = remember { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var progress by remember { mutableIntStateOf(0) }
    // The app's page failed to load (offline, DNS, server down, a bad certificate).
    var loadFailure by remember { mutableStateOf<LoadFailure?>(null) }
    // The page tried to take the app's frame to another site.
    var leftOrigin by remember { mutableStateOf<LeftOrigin?>(null) }
    val page = remember(appId) { AppPageState() }
    val reload: () -> Unit = {
        loadFailure = null
        leftOrigin = null
        webView?.let { wv ->
            // Nothing of the app showed yet (a certificate error or a redirect
            // away left no page behind): start it over.
            if (page.hasCommittedPage) wv.reload() else app?.let { wv.loadUrl(it.url) }
        }
    }

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
                        IconButton(onClick = reload) {
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
                else -> {
                    val openExternally = rememberOpenExternally()
                    AppWebView(
                        wallet = wallet,
                        app = app,
                        page = page,
                        openExternally = openExternally,
                        onCreated = { webView = it },
                        onProgress = { progress = it },
                        onRendererGone = onClose,
                        onLoadStarted = { onAppOrigin ->
                            loadFailure = null
                            if (onAppOrigin) leftOrigin = null
                        },
                        onLoadFailed = { failure ->
                            // A certificate error can be followed by a generic one for the same load.
                            if (loadFailure != LoadFailure.Insecure) loadFailure = failure
                        },
                        onLeftOrigin = { target, beforeFirstPage -> leftOrigin = LeftOrigin(target, beforeFirstPage) },
                    )
                    val host = app.origin.removePrefix("https://")
                    val left = leftOrigin
                    val failure = loadFailure
                    when {
                        left != null -> LeftOriginMessage(
                            from = host,
                            notice = left,
                            onOpenExternally = {
                                leftOrigin = null
                                openExternally(left.target)
                            },
                            onDismiss = { leftOrigin = null },
                        )
                        // Covers Chromium's white "Webpage not available" page.
                        failure != null -> LoadFailedMessage(host = host, failure = failure, onRetry = reload)
                    }
                }
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

/** Why the app's page didn't load. */
internal enum class LoadFailure {
    /** Offline, DNS, the server is down: Chromium's own error page. */
    Unreachable,

    /** The site's certificate isn't valid (expired, wrong host, a captive portal or TLS interception). */
    Insecure,
}

/** The page tried to take the app's frame to [target]; nothing of the app showed yet when [beforeFirstPage]. */
private data class LeftOrigin(val target: Uri, val beforeFirstPage: Boolean)

/** Whether a page of the app has shown in this web view, for Retry and for telling a reload from the first load. */
internal class AppPageState {
    var hasCommittedPage = false
}

@Composable
private fun LoadFailedMessage(host: String, failure: LoadFailure, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Void)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(host, style = MonoStyle.copy(fontSize = 15.sp, lineHeight = 20.sp), color = Bone, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            when (failure) {
                LoadFailure.Unreachable -> "Can't reach $host. Check your connection and try again."
                LoadFailure.Insecure -> "$host's connection isn't secure (its certificate isn't valid). " +
                    "If you're on public Wi-Fi, sign in to the network first."
            },
            color = Fog,
            fontSize = 14.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        BracketAction("Retry", onClick = onRetry)
    }
}

/** The page left the app's origin: where it went, and the way out (the system browser). Same wording as iOS. */
@Composable
private fun LeftOriginMessage(from: String, notice: LeftOrigin, onOpenExternally: () -> Unit, onDismiss: () -> Unit) {
    val to = notice.target.host ?: notice.target.toString()
    Box(modifier = Modifier.fillMaxSize().background(Void), contentAlignment = Alignment.Center) {
        // Centered when it fits, scrolling when it doesn't (large text, landscape).
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
                .widthIn(max = 420.dp)
                .fillMaxWidth(),
        ) {
            Text("> LEFT THE APP", style = MonoStyle.copy(fontSize = 12.sp, lineHeight = 16.sp), color = Amber)
            Spacer(Modifier.height(12.dp))
            Text("$from redirected to $to", style = MonoStyle.copy(fontSize = 15.sp, lineHeight = 20.sp), color = Bone)
            Spacer(Modifier.height(8.dp))
            Text(
                if (notice.beforeFirstPage) {
                    "The wallet only runs $from here. If the app moved, add it again as $to, or open it in your browser."
                } else {
                    "The wallet only runs $from here. Other sites open in your browser."
                },
                color = Fog,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(16.dp))
            PrimaryButton("Open in browser", onClick = onOpenExternally, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            GhostButton("Dismiss", onClick = onDismiss, modifier = Modifier.fillMaxWidth())
        }
    }
}

/** Opens a link in the system browser (outside the wallet, without the bridge). */
@Composable
private fun rememberOpenExternally(): (Uri) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { uri ->
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
    }
}

@SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
@Composable
private fun AppWebView(
    wallet: WalletStore,
    app: InstalledApp,
    page: AppPageState,
    openExternally: (Uri) -> Unit,
    onCreated: (WebView) -> Unit,
    onProgress: (Int) -> Unit,
    onRendererGone: () -> Unit,
    onLoadStarted: (onAppOrigin: Boolean) -> Unit,
    onLoadFailed: (LoadFailure) -> Unit,
    onLeftOrigin: (target: Uri, beforeFirstPage: Boolean) -> Unit,
) {
    val context = LocalContext.current
    val origin = app.origin
    val bridge = remember(app.id) {
        AppBridge(wallet, ProxyService(wallet, context.applicationContext), origin)
    }
    DisposableEffect(bridge) {
        onDispose { bridge.dispose() }
    }

    // <input type=file>: Android WebView shows no picker of its own, so the
    // page's request goes to the system file picker and is answered once.
    val fileRequest = remember { FileChooserRequest() }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileRequest.finish(pickedFiles(result.resultCode, result.data))
    }
    DisposableEffect(fileRequest) {
        onDispose { fileRequest.finish(null) }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            WebView(ctx).apply {
                // Void, not white, until the first page shows (see onPageCommitVisible).
                setBackgroundColor(Void.toArgb())
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
                    page = page,
                    injectOnPageStart = !documentStart,
                    openExternally = openExternally,
                    onLeftOrigin = onLeftOrigin,
                    onPageReplaced = bridge::cancelInFlight,
                    onRendererGone = onRendererGone,
                    onLoadStarted = onLoadStarted,
                    onLoadFailed = onLoadFailed,
                )
                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView, newProgress: Int) {
                        onProgress(newProgress)
                    }

                    override fun onShowFileChooser(
                        webView: WebView,
                        filePathCallback: ValueCallback<Array<Uri>>,
                        fileChooserParams: FileChooserParams,
                    ): Boolean {
                        fileRequest.start(filePathCallback)
                        try {
                            filePicker.launch(fileChooserParams.createIntent())
                        } catch (_: ActivityNotFoundException) {
                            fileRequest.finish(null)
                        }
                        return true
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

/** The page's pending file request. Every callback is answered exactly once, null when cancelled. */
private class FileChooserRequest {
    private var callback: ValueCallback<Array<Uri>>? = null

    fun start(newCallback: ValueCallback<Array<Uri>>) {
        finish(null)
        callback = newCallback
    }

    fun finish(uris: Array<Uri>?) {
        val pending = callback ?: return
        callback = null
        pending.onReceiveValue(uris)
    }
}

/** The files the picker returned, one or several, or null when it was cancelled. */
private fun pickedFiles(resultCode: Int, data: Intent?): Array<Uri>? {
    if (resultCode != Activity.RESULT_OK) return null
    WebChromeClient.FileChooserParams.parseResult(resultCode, data)?.let { return it }
    val clip = data?.clipData ?: return null
    return Array(clip.itemCount) { clip.getItemAt(it).uri }
}

/** What the in-wallet browser does with a navigation (see [navigationDecision]). */
internal enum class NavigationDecision {
    Allow,

    /** A link the user tapped to another site: hand it to the system browser. */
    OpenExternally,

    /** The page sent itself to another site (a server redirect, a script): stop and say so. */
    BlockedRedirect,
    Cancel,
}

/**
 * Navigation policy, as iOS's `AppWebView.navigationDecision`. The main frame
 * may only show the app's own https origin ([appOrigin]; [origin] is the
 * request's, see [AppBridge.originOf]). A link the user taps to another
 * http(s) site opens in the system browser; a page that sends itself
 * elsewhere is stopped with a notice: a server redirect ([isRedirect], also
 * of a tapped link) or a navigation without a tap (a script). Other schemes
 * (intent:, file:, javascript:, custom) never load. Subframes are left to the
 * page: they never get the bridge, which is scoped to the main frame's origin.
 */
internal fun navigationDecision(
    scheme: String?,
    origin: String?,
    isMainFrame: Boolean,
    isRedirect: Boolean,
    hasGesture: Boolean,
    appOrigin: String,
): NavigationDecision {
    if (!isMainFrame) return NavigationDecision.Allow
    val s = scheme?.lowercase()
    if (s == "https" && origin == appOrigin) return NavigationDecision.Allow
    if (s != "https" && s != "http") return NavigationDecision.Cancel
    return if (hasGesture && !isRedirect) NavigationDecision.OpenExternally else NavigationDecision.BlockedRedirect
}

internal open class AppWebViewClient(
    private val appOrigin: String,
    private val page: AppPageState,
    private val injectOnPageStart: Boolean,
    private val openExternally: (Uri) -> Unit,
    private val onLeftOrigin: (target: Uri, beforeFirstPage: Boolean) -> Unit,
    private val onPageReplaced: () -> Unit,
    private val onRendererGone: () -> Unit,
    private val onLoadStarted: (onAppOrigin: Boolean) -> Unit,
    private val onLoadFailed: (LoadFailure) -> Unit,
) : WebViewClient() {
    private var lastBlockedUrl: String? = null
    private var lastBlockedAt = 0L

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        return when (navigationDecision(uri.scheme, AppBridge.originOf(uri), request.isForMainFrame, request.isRedirect, request.hasGesture(), appOrigin)) {
            NavigationDecision.Allow -> false
            NavigationDecision.OpenExternally -> {
                openExternally(uri)
                true
            }
            NavigationDecision.BlockedRedirect -> {
                onLeftOrigin(uri, !page.hasCommittedPage)
                true
            }
            NavigationDecision.Cancel -> true
        }
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        // WebView calls this once a main-frame document commits, not for
        // pushState or #fragment changes. A new one after an app page (Reload,
        // a navigation, a new window loaded in place) replaced that page: its
        // requests stop. The first page replaces nothing.
        if (page.hasCommittedPage) onPageReplaced()
        val onAppOrigin = url != null && isAppOrigin(Uri.parse(url))
        onLoadStarted(onAppOrigin)
        if (leaveIfOffOrigin(view, url)) return
        if (onAppOrigin) page.hasCommittedPage = true
        // Fallback for WebViews without document-start scripts. Racier (page
        // scripts may run first) but the SDK only looks for the wallet when
        // the app calls connect().
        if (injectOnPageStart && onAppOrigin) {
            view.evaluateJavascript(AppBridge.BRIDGE_JS, null)
        }
    }

    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
        super.doUpdateVisitedHistory(view, url, isReload)
        leaveIfOffOrigin(view, url)
    }

    private fun isAppOrigin(uri: Uri) = uri.scheme == "https" && AppBridge.originOf(uri) == appOrigin

    /**
     * shouldOverrideUrlLoading isn't called for every navigation (form POSTs,
     * for one), so the main frame could otherwise land on another origin
     * while the title bar still names the app. When that happens, stop, say
     * where it went (the notice offers the system browser) and put the app
     * back.
     */
    private fun leaveIfOffOrigin(view: WebView, url: String?): Boolean {
        if (url == null) return false
        val uri = Uri.parse(url)
        if (uri.scheme == "about") return false
        if (isAppOrigin(uri)) return false

        view.stopLoading()
        val now = System.currentTimeMillis()
        val repeat = url == lastBlockedUrl && now - lastBlockedAt < 2_000
        lastBlockedUrl = url
        lastBlockedAt = now
        if (!repeat && (uri.scheme == "https" || uri.scheme == "http")) onLeftOrigin(uri, !page.hasCommittedPage)
        // No app page to return to (the start URL itself left the origin):
        // show a blank page rather than reloading into the same redirect.
        if (view.canGoBack()) view.goBack() else view.loadUrl("about:blank")
        return true
    }

    override fun onPageCommitVisible(view: WebView, url: String?) {
        super.onPageCommitVisible(view, url)
        // Back to the browser default once a page is up: a page that sets no
        // background of its own expects white behind its text.
        view.setBackgroundColor(android.graphics.Color.WHITE)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (!request.isForMainFrame) return
        // The wallet shows its own message (and Retry) instead of Chromium's error page.
        view.stopLoading()
        onLoadFailed(LoadFailure.Unreachable)
    }

    /**
     * A certificate error is never let through. Cancelled, it fails the load
     * without an onReceivedError, which would leave a blank screen; for the
     * app's own origin (its page, or calls to its own server) the wallet says
     * why. Other sites' resources just don't load.
     */
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        if (isAppOrigin(Uri.parse(error.url))) onLoadFailed(LoadFailure.Insecure)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // The page is gone with its renderer, and so are its requests. Keep
        // the wallet alive; leave the app.
        onPageReplaced()
        onRendererGone()
        return true
    }
}
