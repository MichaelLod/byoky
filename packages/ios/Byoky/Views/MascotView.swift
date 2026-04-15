import SwiftUI
import WebKit

/// Renders the Byoky "B" brand mark from the bundled SVG.
struct BrandMark: View {
    var size: CGFloat = 120

    var body: some View {
        if let url = Bundle.main.url(forResource: "mascot", withExtension: "svg"),
           let svgData = try? Data(contentsOf: url),
           let svgString = String(data: svgData, encoding: .utf8) {
            SVGWebView(svg: svgString)
                .frame(width: size, height: size)
        } else {
            Image(systemName: "key.fill")
                .font(.system(size: size * 0.5))
                .foregroundStyle(Theme.accent)
        }
    }
}


/// Renders a provider's brand mark from the asset catalog. Falls back to a
/// generic key glyph when the provider id isn't recognized.
struct ProviderIcon: View {
    let providerId: String
    var size: CGFloat = 20

    var body: some View {
        if let provider = Provider.find(providerId) {
            Image(provider.icon)
                .resizable()
                .renderingMode(.template)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            Image(systemName: "key")
                .font(.system(size: size))
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
