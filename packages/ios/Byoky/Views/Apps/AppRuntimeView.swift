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
                        Text("Invalid app URL")
                            .foregroundStyle(.secondary)
                        Text("Only HTTPS URLs are allowed.")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .navigationTitle(app.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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
        webView.backgroundColor = .systemBackground
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        handler.attach(to: webView)
        // The user opened this app (from the Apps grid, or right after adding
        // it): that is consent for it to connect, including after a revoke in
        // Connected Apps. Granted before the page loads so it can't race.
        wallet.grantAppAccess(origin: allowedOrigin)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

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
                    body: data.body || null
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
