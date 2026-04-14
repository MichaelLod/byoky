import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet: WalletStore

    init() {
        let args = CommandLine.arguments
        let isUITest = args.contains("-byokyUITest")
        let shouldReset = args.contains("-byokyResetOnLaunch")

        if shouldReset {
            WalletStore.shared.resetWallet()
        }

        // Test-only fast path: if a config file exists at
        // /tmp/byoky-ios-test-config.json with a `geminiKey` (or any
        // `credentials` array), auto-create the wallet + import the
        // keys so the XCUITest can skip the flaky onboarding + add-
        // credential form interactions entirely and go straight to the
        // gift / bridge / group flows that actually matter.
        if isUITest {
            Self.autoSetupIfNeeded()
        }

        _wallet = StateObject(wrappedValue: WalletStore.shared)
    }

    private static func autoSetupIfNeeded() {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard let data = FileManager.default.contents(atPath: configPath),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }

        let w = WalletStore.shared
        if w.status == .uninitialized {
            let password = (config["password"] as? String) ?? "UITestDefault1234!"
            try? w.createPassword(password)

            if let geminiKey = config["geminiKey"] as? String, !geminiKey.isEmpty {
                try? w.addCredential(providerId: "gemini", label: "Google Gemini", apiKey: geminiKey)
            }
            if let anthropicKey = config["anthropicKey"] as? String, !anthropicKey.isEmpty {
                try? w.addCredential(providerId: "anthropic", label: "Anthropic", apiKey: anthropicKey)
            }
            if let openaiKey = config["openaiKey"] as? String, !openaiKey.isEmpty {
                try? w.addCredential(providerId: "openai", label: "OpenAI", apiKey: openaiKey)
            }
        }

        // Reverse-gift flow: after the XCUITest redeems a desktop-created gift
        // on iOS, we need iOS to actually *call* through that gift relay to
        // prove the round-trip works. No user-facing UI exists to trigger a
        // test request, so the test config asks the app to do it once the
        // gift shows up. Result lands in /tmp for the Playwright side to
        // assert against.
        if let fireProvider = config["fireAfterSetup"] as? String, !fireProvider.isEmpty {
            let resultPath = (config["fireResultOut"] as? String)
                ?? "/tmp/byoky-ios-proxy-result.json"
            Task.detached { await fireTestRequestWhenGiftArrives(providerId: fireProvider, resultPath: resultPath) }
        }
    }

    /// Poll the wallet for a redeemed gift on `providerId` for up to ~90s, then
    /// hit the provider's API via the gift relay and write a small JSON result
    /// summary to `resultPath`. Keeps the app running (the GiftRelayProxy
    /// recipient-side socket needs the app in foreground).
    private static func fireTestRequestWhenGiftArrives(providerId: String, resultPath: String) async {
        let w = WalletStore.shared
        var gc: GiftedCredential? = nil
        for _ in 0..<180 { // 180 × 500ms = 90s
            let found = await MainActor.run { () -> GiftedCredential? in
                w.giftedCredentials.first(where: { $0.providerId == providerId })
            }
            if let found {
                gc = found
                break
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }

        guard let gc else {
            writeResult(to: resultPath, payload: [
                "success": false,
                "error": "No gifted credential for provider \(providerId) within 90s",
            ])
            return
        }

        // Give the recipient socket machinery a moment to settle after
        // redemption before firing the real request. Without this, the
        // very-first connect on a fresh app sometimes surfaces ENOTCONN
        // ("Socket is not connected") from URLSessionWebSocketTask.
        try? await Task.sleep(nanoseconds: 3_000_000_000)

        let (url, method, headers, body) = buildTestRequest(for: providerId)
        guard let url else {
            writeResult(to: resultPath, payload: [
                "success": false,
                "error": "Unsupported provider for auto-fire: \(providerId)",
            ])
            return
        }

        var lastError: Error? = nil
        for attempt in 1...3 {
            var responseText = ""
            var status = 0
            do {
                for try await event in proxyViaGiftRelay(
                    giftedCredential: gc,
                    requestId: UUID().uuidString,
                    providerId: providerId,
                    url: url,
                    method: method,
                    headers: headers,
                    body: body
                ) {
                    switch event {
                    case .meta(let s, _, _):
                        status = s
                    case .chunk(let chunk):
                        responseText.append(chunk)
                    case .usage, .done:
                        break
                    }
                }
                writeResult(to: resultPath, payload: [
                    "success": status >= 200 && status < 400 && !responseText.isEmpty,
                    "status": status,
                    "providerId": providerId,
                    "responseBytes": responseText.count,
                    "response": String(responseText.prefix(400)),
                    "attempts": attempt,
                ])
                return
            } catch {
                lastError = error
                // Fresh URLSessionWebSocketTask sometimes needs a retry when
                // the first one is torn down mid-handshake. Wait briefly and
                // try again with a new task.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
            }
        }
        writeResult(to: resultPath, payload: [
            "success": false,
            "error": lastError?.localizedDescription ?? "unknown error",
            "providerId": providerId,
            "attempts": 3,
        ])
    }

    private static func buildTestRequest(for providerId: String)
        -> (String?, String, [String: String], String?)
    {
        switch providerId {
        case "anthropic":
            // Use a model that Claude Code supports — setup tokens
            // (sk-ant-oat01-…) only grant access to models Claude Code
            // itself is permitted to call. Haiku 4.5 is the cheap option
            // from that allow-list.
            let body = """
            {"model":"claude-haiku-4-5-20251001","max_tokens":32,"messages":[{"role":"user","content":"Say hi in one word."}]}
            """
            return ("https://api.anthropic.com/v1/messages", "POST", [
                "content-type": "application/json",
                "anthropic-version": "2023-06-01",
            ], body)
        case "openai":
            let body = """
            {"model":"gpt-4o-mini","max_tokens":32,"messages":[{"role":"user","content":"Say hi in one word."}]}
            """
            return ("https://api.openai.com/v1/chat/completions", "POST", [
                "content-type": "application/json",
            ], body)
        case "gemini":
            let body = """
            {"contents":[{"parts":[{"text":"Say hi in one word."}]}]}
            """
            return (
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
                "POST",
                ["content-type": "application/json"],
                body
            )
        default:
            return (nil, "POST", [:], nil)
        }
    }

    private static func writeResult(to path: String, payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) else { return }
        try? data.write(to: URL(fileURLWithPath: path))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(wallet)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
        }
    }

    private func handleIncomingURL(_ url: URL) {
        guard url.scheme == "byoky" else { return }
        // byoky://gift/<encoded> — host is "gift", path holds the payload.
        // Absolute fallback: stash the whole URL string so RedeemGiftView's
        // existing parser can strip the prefix.
        if url.host == "gift" {
            wallet.pendingGiftLink = url.absoluteString
        }
    }
}
