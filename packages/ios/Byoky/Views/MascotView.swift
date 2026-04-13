import SwiftUI
import WebKit

/// Renders the Byoky owl mascot from the bundled SVG.
struct MascotView: View {
    var size: CGFloat = 120

    var body: some View {
        if let url = Bundle.main.url(forResource: "mascot", withExtension: "svg"),
           let svgData = try? Data(contentsOf: url),
           let svgString = String(data: svgData, encoding: .utf8) {
            SVGWebView(svg: svgString)
                .frame(width: size, height: size)
        } else {
            // Fallback: simple owl silhouette using SF Symbol
            Image(systemName: "bird.fill")
                .font(.system(size: size * 0.5))
                .foregroundStyle(Theme.accent)
        }
    }
}

/// Lightweight WKWebView wrapper that renders an SVG string.
struct SVGWebView: UIViewRepresentable {
    let svg: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false

        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; }
            body { background: transparent; display: flex; align-items: center; justify-content: center; height: 100vh; }
            svg { width: 100%; height: 100%; }
        </style>
        </head>
        <body>\(svg)</body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
