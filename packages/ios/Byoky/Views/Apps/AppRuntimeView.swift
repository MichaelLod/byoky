import SwiftUI
import WebKit

struct AppRuntimeView: View {
    let app: InstalledApp
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss
    @StateObject private var browser = AppBrowserState()

    /// The app's https URL, or nil when the stored address isn't usable.
    private var startURL: URL? {
        guard let url = URL(string: app.url), url.scheme == "https", url.host != nil else { return nil }
        return url
    }

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if let url = startURL {
                    AppWebView(url: url, allowedOrigin: InstalledApp.origin(of: url), wallet: wallet, browser: browser)
                        .ignoresSafeArea(edges: .bottom)
                        .overlay(alignment: .top) { progressBar }
                        .overlay {
                            if let notice = browser.notice {
                                AppBrowserNoticeView(
                                    notice: notice,
                                    onReload: { browser.reload() },
                                    onOpenExternally: { target in
                                        browser.notice = nil
                                        UIApplication.shared.open(target)
                                    },
                                    onDismiss: { browser.notice = nil }
                                )
                            }
                        }
                } else {
                    VStack(spacing: 8) {
                        PromptLine("Invalid app URL", color: Theme.alarm)
                        Text("Only HTTPS URLs are allowed.")
                            .font(.caption)
                            .foregroundStyle(Theme.fog)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ScreenBackground())
                }
            }
            .navigationTitle(app.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // The app's name over its address, like a terminal title bar.
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(app.name)
                            .uppercaseDisplay()
                            .font(.display(15, weight: .semibold, relativeTo: .headline))
                            .tracking(1.2)
                            .foregroundStyle(Theme.bone)
                        if let host = URL(string: app.url)?.host {
                            Text(host)
                                .font(.mono(11, relativeTo: .caption2))
                                .foregroundStyle(Theme.dim)
                        }
                    }
                    .lineLimit(1)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                }

                ToolbarItemGroup(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("appRuntime.close")

                    if startURL != nil {
                        Button {
                            browser.goBack()
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .disabled(!browser.canGoBack)
                        .accessibilityLabel("Back")
                        .accessibilityIdentifier("appRuntime.back")
                    }
                }

                if startURL != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            browser.reload()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("Reload")
                        .accessibilityIdentifier("appRuntime.reload")
                    }
                }
            }
        }
    }

    /// A 2pt violet bar along the top while a page loads.
    @ViewBuilder
    private var progressBar: some View {
        if browser.isLoading {
            GeometryReader { geometry in
                Rectangle()
                    .fill(Theme.violet)
                    .frame(width: geometry.size.width * max(0.05, browser.progress))
                    .animation(.easeOut(duration: 0.2), value: browser.progress)
            }
            .frame(height: 2)
            .allowsHitTesting(false)
            .accessibilityElement()
            .accessibilityLabel("Loading")
            .accessibilityValue("\(Int(browser.progress * 100)) percent")
        }
    }
}

// MARK: - Browser state

/// What the in-wallet browser shows over the page instead of leaving the
/// user in front of a blank screen.
enum AppBrowserNotice: Equatable {
    /// The page couldn't load: DNS, TLS, offline, the server is down.
    case loadFailed(host: String, message: String)
    /// The page's web content process ended (memory pressure, a crash).
    case stopped
    /// The page sent the browser to another site without a tap (a server
    /// redirect or a script). The wallet only runs the app's own origin.
    /// `beforeFirstPage`: nothing of the app had loaded yet.
    case leftOrigin(from: String, to: URL, beforeFirstPage: Bool)
}

/// Loading progress, back history and notices of one in-wallet browser,
/// shared by the toolbar, the overlays and the web view's coordinator.
@MainActor
final class AppBrowserState: ObservableObject {
    @Published var progress: Double = 0
    @Published var isLoading = false
    @Published var canGoBack = false
    @Published var notice: AppBrowserNotice?

    weak var webView: WKWebView?
    var startURL: URL?
    /// A page of the app was shown (a main-frame navigation committed).
    var hasCommittedPage = false
    /// The main-frame address whose load failed last, for Reload.
    var failedURL: URL?

    func goBack() {
        webView?.goBack()
    }

    /// Tries the failed address again, or reloads the page. Before anything
    /// loaded there is nothing to reload, so the app starts over.
    func reload() {
        notice = nil
        guard let webView else { return }
        let retry = failedURL ?? (webView.backForwardList.currentItem == nil ? startURL : nil)
        failedURL = nil
        if let retry {
            webView.load(URLRequest(url: retry))
        } else {
            webView.reload()
        }
    }

    /// Load errors that are not failures the user needs to see: a load
    /// replaced by another one (NSURLErrorCancelled), one the navigation
    /// policy stopped (WebKit 102, "Frame load interrupted") and media that
    /// WebKit hands to its player (WebKit 204, "Plug-in handled load").
    nonisolated static func isIgnorableLoadError(_ error: Error) -> Bool {
        let error = error as NSError
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
        if error.domain == "WebKitErrorDomain" && (error.code == 102 || error.code == 204) { return true }
        return false
    }

    nonisolated static func failingURL(of error: Error) -> URL? {
        (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL
    }
}

/// The page couldn't load, stopped, or left the app: what happened, and the
/// way out (Reload, or the system browser).
private struct AppBrowserNoticeView: View {
    let notice: AppBrowserNotice
    let onReload: () -> Void
    let onOpenExternally: (URL) -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch notice {
            case .loadFailed(let host, let message):
                PromptLine("Couldn't load", color: Theme.alarm)
                Text(host)
                    .font(.mono(15, relativeTo: .body))
                    .foregroundStyle(Theme.bone)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(Theme.fog)
                    .fixedSize(horizontal: false, vertical: true)
                reloadButton

            case .stopped:
                PromptLine("The app stopped", color: Theme.amber)
                Text("The page closed unexpectedly, often because the phone ran low on memory.")
                    .font(.callout)
                    .foregroundStyle(Theme.fog)
                    .fixedSize(horizontal: false, vertical: true)
                reloadButton

            case .leftOrigin(let from, let target, let beforeFirstPage):
                let targetHost = target.host ?? target.absoluteString
                PromptLine("Left the app", color: Theme.amber)
                Text("\(from) redirected to \(targetHost)")
                    .font(.mono(15, relativeTo: .body))
                    .foregroundStyle(Theme.bone)
                    .fixedSize(horizontal: false, vertical: true)
                Text(beforeFirstPage
                     ? "The wallet only runs \(from) here. If the app moved, add it again as \(targetHost), or open it in your browser."
                     : "The wallet only runs \(from) here. Other sites open in your browser.")
                    .font(.callout)
                    .foregroundStyle(Theme.fog)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Open in Browser") { onOpenExternally(target) }
                    .buttonStyle(RetroButtonStyle(kind: .primary, height: 48))
                    .padding(.top, 4)
                    .accessibilityIdentifier("appRuntime.openExternally")
                Button("Dismiss", action: onDismiss)
                    .buttonStyle(RetroButtonStyle(kind: .ghost, height: 48))
                    .accessibilityIdentifier("appRuntime.dismissNotice")
            }
        }
        .padding(20)
        .frame(maxWidth: 420)
        .retroCard(border: Theme.seamStrong)
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScreenBackground())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("appRuntime.notice")
    }

    private var reloadButton: some View {
        Button("Reload", action: onReload)
            .buttonStyle(RetroButtonStyle(kind: .primary, height: 48))
            .padding(.top, 4)
            .accessibilityIdentifier("appRuntime.notice.reload")
    }
}

// MARK: - Opening an app

extension View {
    /// Opens `app` in the in-wallet browser whenever it is set (then resets
    /// it). An app whose site the user disconnected in Connected Apps asks
    /// "Reconnect?" first: Reconnect lifts the revoke and opens it, Cancel
    /// leaves it closed and disconnected. Other apps open right away.
    func opensInstalledApp(_ app: Binding<InstalledApp?>) -> some View {
        modifier(InstalledAppLauncher(request: app))
    }
}

private struct InstalledAppLauncher: ViewModifier {
    @EnvironmentObject var wallet: WalletStore
    @Binding var request: InstalledApp?
    @State private var reconnecting: InstalledApp?
    /// Reconnect was confirmed; the app opens once the request sheet is gone.
    @State private var reconnected: InstalledApp?
    @State private var open: InstalledApp?

    func body(content: Content) -> some View {
        content
            .onChange(of: request) { _, app in
                guard let app else { return }
                request = nil
                if wallet.needsReapproval(app) {
                    reconnecting = app
                } else {
                    open = app
                }
            }
            // Cancel (or swiping the sheet away) leaves the app closed and
            // disconnected.
            .sheet(item: $reconnecting, onDismiss: {
                // Presenting the browser while the sheet animates out is dropped.
                open = reconnected
                reconnected = nil
            }) { app in
                ReconnectRequestView(
                    app: app,
                    host: Self.displayHost(app),
                    onCancel: { reconnecting = nil },
                    onReconnect: {
                        if let url = URL(string: app.url), url.host != nil {
                            wallet.grantAppAccess(origin: InstalledApp.origin(of: url))
                        }
                        reconnected = app
                        reconnecting = nil
                    }
                )
            }
            .fullScreenCover(item: $open) { app in
                AppRuntimeView(app: app)
                    .environmentObject(wallet)
            }
    }

    /// `host[:port]` of the app, as the user knows the site.
    static func displayHost(_ app: InstalledApp) -> String {
        guard let url = URL(string: app.url), let host = url.host else { return app.name }
        if let port = url.port, port != 443 { return "\(host):\(port)" }
        return host
    }
}

/// "Reconnect?" for an app the user disconnected in Connected Apps — the
/// one connection request on iPhone. Muninn is on alert until you decide.
private struct ReconnectRequestView: View {
    let app: InstalledApp
    let host: String
    let onCancel: () -> Void
    let onReconnect: () -> Void

    @State private var nods = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Muninn(mood: .alert, size: 100, compact: true, nod: nods)
                VStack(alignment: .leading, spacing: 6) {
                    PromptLine("Connection request", size: 11)
                    Text("Reconnect \(app.name)?")
                        .uppercaseDisplay()
                        .font(.display(22, relativeTo: .title2))
                        .tracking(0.7)
                        .foregroundStyle(Theme.bone)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(host)
                    .font(.mono(15, relativeTo: .body))
                    .foregroundStyle(Theme.bone)
                Text("Disconnected in Connected Apps")
                    .font(.footnote)
                    .foregroundStyle(Theme.fog)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.void)
            .overlay(Rectangle().strokeBorder(Theme.seamStrong, lineWidth: 1))
            .padding(.top, 16)

            Text("You disconnected \(host). Reconnecting lets it send AI requests through your keys again. It never sees the keys.")
                .font(.callout)
                .foregroundStyle(Theme.fog)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 14)

            Spacer(minLength: 20)

            HStack(spacing: 10) {
                Button("Cancel", action: onCancel)
                    .buttonStyle(RetroButtonStyle(kind: .ghost, height: 48))
                Button("Reconnect") {
                    nods += 1
                    onReconnect()
                }
                .buttonStyle(RetroButtonStyle(kind: .primary, height: 48))
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .overlay(Scanlines().ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.crypt)
    }
}

struct AppWebView: UIViewRepresentable {
    let url: URL
    /// `https://host[:port]` of the app; the only origin it may navigate to.
    let allowedOrigin: String
    let wallet: WalletStore
    let browser: AppBrowserState

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedOrigin: allowedOrigin, browser: browser)
    }

    func makeUIView(context: Context) -> WKWebView {
        Self.makeWebView(url: url, allowedOrigin: allowedOrigin, wallet: wallet, coordinator: context.coordinator)
    }

    /// The configured web view with the bridge, its delegates and the first
    /// load started.
    static func makeWebView(url: URL, allowedOrigin: String, wallet: WalletStore, coordinator: Coordinator) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // Inject the native bridge script before any page JS runs
        let bridgeScript = WKUserScript(
            source: Self.bridgeJavaScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)

        // WebKit exposes the handler to every frame; NativeBridgeHandler only
        // accepts messages from the app's own main frame.
        let handler = NativeBridgeHandler(wallet: wallet, appOrigin: allowedOrigin)
        coordinator.bridgeHandler = handler
        config.userContentController.add(handler, name: "byoky")

        let webView = WKWebView(frame: .zero, configuration: config)
        // The void shows until the first page commits; then the page gets
        // the white canvas a browser gives it (see `showPageCanvas`).
        webView.isOpaque = false
        webView.backgroundColor = UIColor(Theme.void)
        webView.scrollView.backgroundColor = UIColor(Theme.void)
        // The wallet is dark only; the apps it opens keep seeing the light
        // appearance they always got here.
        webView.overrideUserInterfaceStyle = .light
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = coordinator
        webView.uiDelegate = coordinator
        handler.attach(to: webView)
        coordinator.attach(to: webView, startURL: url)
        // Opening never lifts a revoke by itself: an app the user disconnected
        // in Connected Apps only gets here after "Reconnect" (see
        // `opensInstalledApp`); otherwise the bridge keeps refusing it.
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// The app was closed: its requests stop with it, and the content
    /// controller lets go of the handler.
    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.detach()
        coordinator.bridgeHandler?.close()
        coordinator.bridgeHandler = nil
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "byoky")
        uiView.stopLoading()
    }

    /// JavaScript injected at document_start to bridge the Byoky SDK
    /// protocol to the native wallet via webkit.messageHandlers. Replies come
    /// back through `_deliver(requestId, json)`, called by
    /// NativeBridgeHandler with both values passed as arguments.
    static let bridgeJavaScript = """
    (function() {
        window.__byoky__ = true;
        var pendingPorts = {};
        window.__byokyBridge = {
            _deliver: function(requestId, json) {
                try {
                    var msg = typeof json === 'string' ? JSON.parse(json) : json;
                    var port = pendingPorts[requestId];
                    if (port) {
                        port.postMessage(msg);
                        var t = msg.type;
                        if (t === 'BYOKY_CONNECT_RESPONSE' || t === 'BYOKY_ERROR' ||
                            t === 'BYOKY_PROXY_RESPONSE_DONE' || t === 'BYOKY_PROXY_RESPONSE_ERROR' ||
                            t === 'BYOKY_SESSION_STATUS_RESPONSE' || t === 'BYOKY_SESSION_USAGE_RESPONSE') {
                            delete pendingPorts[requestId];
                        }
                    }
                } catch (e) {
                    console.error('[byoky-bridge] deliver error:', e);
                }
            }
        };
        window.addEventListener('message', function(event) {
            if (event.source !== window) return;
            var data = event.data;
            if (!data || typeof data.type !== 'string' || data.type.indexOf('BYOKY_') !== 0) return;
            var port = event.ports ? event.ports[0] : null;
            var requestId = data.requestId || data.id || '';
            if (port && requestId) pendingPorts[requestId] = port;
            if (data.type === 'BYOKY_REGISTER_NOTIFY') return;
            try {
                window.webkit.messageHandlers.byoky.postMessage({
                    type: data.type,
                    requestId: requestId,
                    payload: data.payload || null,
                    sessionKey: data.sessionKey || '',
                    providerId: data.providerId || '',
                    url: data.url || '',
                    method: data.method || '',
                    headers: data.headers || {},
                    body: data.body || null,
                    bodyEncoding: data.bodyEncoding || null
                });
            } catch (e) {
                console.error('[byoky-bridge] native forward failed:', e);
            }
        });
    })();
    """

    /// Navigation policy. The app's main frame may only show its own https
    /// origin (scheme, host and port): a link the user taps to another site
    /// opens in the system browser, and a page that sends itself elsewhere
    /// (a server redirect, a script) is stopped with a notice. A new window
    /// (target=_blank, window.open) for the app's own origin loads in place.
    /// Subframes may load any https site and `about:` / `blob:` documents
    /// (srcdoc and generated content); they get no bridge: the script is
    /// main-frame only and NativeBridgeHandler ignores messages from other
    /// frames. Other schemes (javascript:, file:, data:, custom) never load.
    static func navigationDecision(
        for url: URL,
        isMainFrame: Bool,
        hasTargetFrame: Bool,
        navigationType: WKNavigationType,
        allowedOrigin: String
    ) -> AppNavigationDecision {
        let scheme = url.scheme?.lowercased() ?? ""
        let isWeb = (scheme == "https" || scheme == "http") && url.host != nil
        let isAppOrigin = scheme == "https" && url.host != nil && InstalledApp.origin(of: url) == allowedOrigin

        if !hasTargetFrame {
            if isAppOrigin { return .loadInPlace }
            return isWeb ? .openExternally(url) : .cancel
        }
        if isMainFrame {
            if isAppOrigin { return .allow }
            guard isWeb else { return .cancel }
            return navigationType == .linkActivated ? .openExternally(url) : .blockedRedirect(url)
        }
        if scheme == "https" && url.host != nil { return .allow }
        if scheme == "about" || scheme == "blob" { return .allow }
        return .cancel
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let allowedOrigin: String
        let browser: AppBrowserState
        var bridgeHandler: NativeBridgeHandler?
        /// Shows a JavaScript dialog and calls back once with the answer
        /// (OK or Cancel, and the text for a prompt). Tests replace it.
        var presentDialog: (JSDialog, WKWebView, @escaping (_ ok: Bool, _ text: String?) -> Void) -> Void = Coordinator.presentAlert
        private var externalLinks = ExternalLinkThrottle()
        private var observations: [NSKeyValueObservation] = []

        init(allowedOrigin: String, browser: AppBrowserState) {
            self.allowedOrigin = allowedOrigin
            self.browser = browser
        }

        /// Follows the web view's progress and back history for the toolbar.
        /// The values reach SwiftUI on the next turn of the main queue: the
        /// first ones change while `makeUIView` runs, inside a view update,
        /// where publishing is not allowed.
        func attach(to webView: WKWebView, startURL: URL) {
            browser.webView = webView
            browser.startURL = startURL
            let browser = browser
            func publish(_ update: @escaping (AppBrowserState) -> Void) {
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { update(browser) }
                }
            }
            observations = [
                webView.observe(\.estimatedProgress, options: [.initial, .new]) { webView, _ in
                    let progress = webView.estimatedProgress
                    publish { $0.progress = progress }
                },
                webView.observe(\.isLoading, options: [.initial, .new]) { webView, _ in
                    let isLoading = webView.isLoading
                    publish { $0.isLoading = isLoading }
                },
                webView.observe(\.canGoBack, options: [.initial, .new]) { webView, _ in
                    let canGoBack = webView.canGoBack
                    publish { $0.canGoBack = canGoBack }
                },
            ]
        }

        func detach() {
            observations.removeAll()
        }

        private var appHost: String {
            URL(string: allowedOrigin)?.host ?? allowedOrigin
        }

        // MARK: Navigation policy

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            let decision = AppWebView.navigationDecision(
                for: url,
                isMainFrame: navigationAction.targetFrame?.isMainFrame ?? true,
                hasTargetFrame: navigationAction.targetFrame != nil,
                navigationType: navigationAction.navigationType,
                allowedOrigin: allowedOrigin
            )
            decisionHandler(decision == .allow ? .allow : .cancel)
            perform(decision, request: navigationAction.request, in: webView)
        }

        /// window.open() from a tap. No second web view: the request goes
        /// through the same policy as target=_blank links.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                let decision = AppWebView.navigationDecision(
                    for: url,
                    isMainFrame: true,
                    hasTargetFrame: false,
                    navigationType: navigationAction.navigationType,
                    allowedOrigin: allowedOrigin
                )
                perform(decision, request: navigationAction.request, in: webView)
            }
            return nil
        }

        private func perform(_ decision: AppNavigationDecision, request: URLRequest, in webView: WKWebView) {
            switch decision {
            case .allow, .cancel:
                break
            case .loadInPlace:
                webView.load(request)
            case .openExternally(let url):
                // One tap can arrive as more than one navigation; open it once.
                guard externalLinks.shouldOpen(url, at: Date()) else { return }
                UIApplication.shared.open(url)
            case .blockedRedirect(let url):
                browser.notice = .leftOrigin(from: appHost, to: url, beforeFirstPage: !browser.hasCommittedPage)
            }
        }

        // MARK: Loading

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            switch browser.notice {
            case .loadFailed, .stopped: browser.notice = nil
            default: break
            }
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            browser.hasCommittedPage = true
            browser.failedURL = nil
            browser.notice = nil
            AppWebView.showPageCanvas(webView)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            showLoadError(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            showLoadError(error)
        }

        private func showLoadError(_ error: Error) {
            guard !AppBrowserState.isIgnorableLoadError(error) else { return }
            let failed = AppBrowserState.failingURL(of: error)
            browser.failedURL = failed
            browser.notice = .loadFailed(host: failed?.host ?? appHost, message: error.localizedDescription)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            browser.notice = .stopped
        }

        // MARK: JavaScript dialogs

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let reply = DialogReply(fallback: ()) { completionHandler() }
            presentDialog(JSDialog(kind: .alert, message: message, host: frame.securityOrigin.host), webView) { _, _ in
                reply.send(())
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let reply = DialogReply(fallback: false, completionHandler)
            presentDialog(JSDialog(kind: .confirm, message: message, host: frame.securityOrigin.host), webView) { ok, _ in
                reply.send(ok)
            }
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let reply = DialogReply<String?>(fallback: nil, completionHandler)
            presentDialog(JSDialog(kind: .prompt(defaultText: defaultText), message: prompt, host: frame.securityOrigin.host), webView) { ok, text in
                reply.send(ok ? (text ?? "") : nil)
            }
        }

        /// A system alert titled with the page's host, presented over
        /// whatever is on top. With nothing to present from, the dialog is
        /// answered with Cancel right away.
        static func presentAlert(_ dialog: JSDialog, from webView: WKWebView, reply: @escaping (Bool, String?) -> Void) {
            var top = webView.window?.rootViewController
            while let presented = top?.presentedViewController, !presented.isBeingDismissed {
                top = presented
            }
            guard let presenter = top, !presenter.isBeingDismissed else {
                reply(false, nil)
                return
            }
            let alert = UIAlertController(
                title: dialog.host.isEmpty ? nil : dialog.host,
                message: dialog.message,
                preferredStyle: .alert
            )
            switch dialog.kind {
            case .alert:
                alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in reply(true, nil) })
            case .confirm:
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in reply(false, nil) })
                alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in reply(true, nil) })
            case .prompt(let defaultText):
                alert.addTextField { $0.text = defaultText }
                alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in reply(false, nil) })
                alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
                    reply(true, alert?.textFields?.first?.text ?? "")
                })
            }
            presenter.present(alert, animated: true)
        }
    }

    /// Once a page has committed, the web view is an opaque white canvas, as
    /// in a browser: a page without its own background stays readable
    /// instead of showing the wallet's void through (with the light
    /// appearance's black text on it).
    static func showPageCanvas(_ webView: WKWebView) {
        guard !webView.isOpaque else { return }
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
    }
}

/// What the in-wallet browser does with a navigation (see
/// `AppWebView.navigationDecision`).
enum AppNavigationDecision: Equatable {
    case allow
    /// A new window for the app's own origin: load it in this web view.
    case loadInPlace
    /// A link to another site: hand it to the system browser.
    case openExternally(URL)
    /// The page sent itself to another site: stop and say so.
    case blockedRedirect(URL)
    case cancel
}

/// Opens each external link once: the same address again within two
/// seconds is the same tap arriving twice.
struct ExternalLinkThrottle {
    static let window: TimeInterval = 2
    private var last: (url: URL, at: Date)?

    mutating func shouldOpen(_ url: URL, at now: Date) -> Bool {
        if let last, last.url == url, now.timeIntervalSince(last.at) < Self.window {
            return false
        }
        last = (url, now)
        return true
    }
}

/// A JavaScript alert(), confirm() or prompt() the page opened.
struct JSDialog: Equatable {
    enum Kind: Equatable {
        case alert
        case confirm
        case prompt(defaultText: String?)
    }

    let kind: Kind
    let message: String
    /// Host of the frame that opened it, shown as the title so a page can't
    /// pass its dialog off as the wallet's.
    let host: String
}

/// Calls a WebKit dialog completion handler exactly once: with the answer,
/// or with `fallback` if the dialog goes away unanswered. WebKit raises an
/// exception when such a handler is released without being called.
final class DialogReply<Value> {
    private var handler: ((Value) -> Void)?
    private let fallback: Value

    init(fallback: Value, _ handler: @escaping (Value) -> Void) {
        self.fallback = fallback
        self.handler = handler
    }

    func send(_ value: Value) {
        let handler = self.handler
        self.handler = nil
        handler?(value)
    }

    deinit {
        handler?(fallback)
    }
}
