// Renders the Mac app's page (packages/ios/macOS/Resources) the way its
// ViewController does, in a real WKWebView, and saves a PNG at `scale`x.
//   snap <Resources dir> <out.png> <true|false> [scale]
import AppKit
import WebKit

let args = CommandLine.arguments
let resources = URL(fileURLWithPath: args[1])
let out = URL(fileURLWithPath: args[2])
let enabled = args.count > 3 ? args[3] : "true"
let scale = args.count > 4 ? Double(args[4]) ?? 4 : 4
let size = NSSize(width: 425, height: 325) // Main.storyboard's window content

final class Delegate: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("show('mac', \(enabled), true)") { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                let config = WKSnapshotConfiguration()
                config.snapshotWidth = NSNumber(value: Double(size.width) * scale / (NSScreen.main?.backingScaleFactor ?? 2))
                webView.takeSnapshot(with: config) { image, error in
                    guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                        print("snapshot failed: \(String(describing: error))"); exit(1)
                    }
                    let rep = NSBitmapImageRep(cgImage: cg)
                    try! rep.representation(using: .png, properties: [:])!.write(to: out)
                    print("wrote \(out.path) \(cg.width)x\(cg.height)")
                    exit(0)
                }
            }
        }
    }
}

let app = NSApplication.shared
app.appearance = NSAppearance(named: .darkAqua)
let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled], backing: .buffered, defer: false)
let webView = WKWebView(frame: window.contentView!.bounds)
webView.underPageBackgroundColor = NSColor(red: 0x07 / 255, green: 0x06 / 255, blue: 0x0A / 255, alpha: 1)
window.contentView!.addSubview(webView)
let delegate = Delegate()
webView.navigationDelegate = delegate
webView.loadFileURL(resources.appendingPathComponent("Base.lproj/Main.html"), allowingReadAccessTo: resources)
window.orderFront(nil)
app.run()
