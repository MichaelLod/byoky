import SwiftUI
import WebKit

struct AppRuntimeView: View {
    let app: InstalledApp
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if let url = URL(string: app.url), url.scheme == "https" {
                    AppWebView(url: url, allowedHost: url.host ?? "", wallet: wallet)
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
                }
            }
        }
    }
}

struct AppWebView: UIViewRepresentable {
    let url: URL
    let allowedHost: String
    let wallet: WalletStore

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedHost: allowedHost, wallet: wallet)
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

        let origin = "https://\(url.host ?? allowedHost)"
        let handler = NativeBridgeHandler(wallet: wallet, appOrigin: origin)
        context.coordinator.bridgeHandler = handler
        config.userContentController.add(handler, name: "byoky")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        handler.attach(to: webView)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    /// JavaScript injected at document_start to bridge the Byoky SDK
    /// protocol to the native wallet via webkit.messageHandlers.
    static let bridgeJavaScript = """
    (function() {
        window.__byoky__ = true;
        var pendingPorts = {};
        window.__byokyBridge = {
            _deliver: function(requestId, base64) {
                try {
                    var json = atob(base64);
                    var msg = JSON.parse(json);
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

    class Coordinator: NSObject, WKNavigationDelegate {
        let allowedHost: String
        let wallet: WalletStore
        var bridgeHandler: NativeBridgeHandler?

        init(allowedHost: String, wallet: WalletStore) {
            self.allowedHost = allowedHost
            self.wallet = wallet
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            // Allow HTTPS navigations to the app's own host
            if url.scheme == "https" && url.host == allowedHost {
                decisionHandler(.allow)
                return
            }

            // Allow about:blank and blob: for internal frames
            if url.scheme == "about" || url.scheme == "blob" {
                decisionHandler(.allow)
                return
            }

            // Block everything else
            decisionHandler(.cancel)
        }
    }
}
