import SwiftUI
import WebKit

struct AppRuntimeView: View {
    let app: InstalledApp
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if let url = URL(string: app.url), url.scheme == "https", url.host != nil {
                    AppWebView(url: url, allowedOrigin: InstalledApp.origin(of: url), wallet: wallet)
                        .ignoresSafeArea(edges: .bottom)
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

                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("Close")
                    .accessibilityIdentifier("appRuntime.close")
                }
            }
        }
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

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedOrigin: allowedOrigin)
    }

    func makeUIView(context: Context) -> WKWebView {
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
        context.coordinator.bridgeHandler = handler
        config.userContentController.add(handler, name: "byoky")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(Theme.void)
        // The wallet is dark only; the apps it opens keep seeing the light
        // appearance they always got here.
        webView.overrideUserInterfaceStyle = .light
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        handler.attach(to: webView)
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

    /// Navigation policy. The app's main frame may only load its own https
    /// origin (scheme, host and port). Subframes may load that origin too, and
    /// `about:` / `blob:` documents (srcdoc and generated content), which get
    /// no bridge: the script is main-frame only and NativeBridgeHandler
    /// ignores messages from other frames.
    static func allowsNavigation(to url: URL, isMainFrame: Bool, allowedOrigin: String) -> Bool {
        if url.scheme?.lowercased() == "https", url.host != nil,
           InstalledApp.origin(of: url) == allowedOrigin {
            return true
        }
        if !isMainFrame, let scheme = url.scheme?.lowercased(), scheme == "about" || scheme == "blob" {
            return true
        }
        return false
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let allowedOrigin: String
        var bridgeHandler: NativeBridgeHandler?

        init(allowedOrigin: String) {
            self.allowedOrigin = allowedOrigin
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // No target frame means a new window (target=_blank, window.open):
            // not supported, so blocked.
            guard let url = navigationAction.request.url,
                  let targetFrame = navigationAction.targetFrame else {
                decisionHandler(.cancel)
                return
            }
            let allowed = AppWebView.allowsNavigation(
                to: url,
                isMainFrame: targetFrame.isMainFrame,
                allowedOrigin: allowedOrigin
            )
            decisionHandler(allowed ? .allow : .cancel)
        }
    }
}
