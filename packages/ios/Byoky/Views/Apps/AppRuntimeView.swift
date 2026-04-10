import SwiftUI
import WebKit

struct AppRuntimeView: View {
    let app: InstalledApp
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if let url = URL(string: app.url), url.scheme == "https" {
                    AppWebView(url: url, allowedHost: url.host ?? "")
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

    func makeCoordinator() -> Coordinator {
        Coordinator(allowedHost: allowedHost)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        let allowedHost: String

        init(allowedHost: String) {
            self.allowedHost = allowedHost
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
