import SwiftUI

@main
struct ByokyApp: App {
    @StateObject private var wallet: WalletStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var hasCheckedClipboardForGift = false

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
            let firePayload = (config["firePayload"] as? String) ?? "chat"
            Task.detached { await fireTestRequestWhenGiftArrives(providerId: fireProvider, resultPath: resultPath, firePayload: firePayload) }
        }
    }

    /// Poll the wallet for a redeemed gift on `providerId` for up to ~90s, then
    /// hit the provider's API via the gift relay and write a small JSON result
    /// summary to `resultPath`. Keeps the app running (the GiftRelayProxy
    /// recipient-side socket needs the app in foreground).
    ///
    /// `firePayload` controls which request body is used. Supported:
    ///   - "chat" (default)   — minimal 32-token hello
    ///   - "stream"           — same body + stream=true; proves SSE chunks survive
    ///   - "vision"           — multipart image+text; 1×1 PNG pixel
    ///   - "tools"            — single-turn weather-tool request
    ///   - "structured"       — json_object/json_schema reply
    private static func fireTestRequestWhenGiftArrives(providerId: String, resultPath: String, firePayload: String = "chat") async {
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
                "mode": firePayload,
            ])
            return
        }

        // Give the recipient socket machinery a moment to settle after
        // redemption before firing the real request. Without this, the
        // very-first connect on a fresh app sometimes surfaces ENOTCONN
        // ("Socket is not connected") from URLSessionWebSocketTask.
        try? await Task.sleep(nanoseconds: 3_000_000_000)

        let (url, method, headers, body) = buildTestRequest(for: providerId, mode: firePayload)
        guard let url else {
            writeResult(to: resultPath, payload: [
                "success": false,
                "error": "Unsupported provider/mode for auto-fire: \(providerId)/\(firePayload)",
                "mode": firePayload,
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
                let (modeOk, modeNote) = validatePayloadShape(mode: firePayload, providerId: providerId, status: status, body: responseText)
                writeResult(to: resultPath, payload: [
                    "success": status >= 200 && status < 400 && !responseText.isEmpty && modeOk,
                    "status": status,
                    "providerId": providerId,
                    "responseBytes": responseText.count,
                    "response": String(responseText.prefix(400)),
                    "attempts": attempt,
                    "mode": firePayload,
                    "modeNote": modeNote ?? "",
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
            "mode": firePayload,
        ])
    }

    /// 1×1 transparent PNG, base64-encoded. Same bytes the demo-playground and Android TestSupport use.
    private static let pixelPngB64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    private static func buildTestRequest(for providerId: String, mode: String)
        -> (String?, String, [String: String], String?)
    {
        let jsonHeaders = ["content-type": "application/json"]
        let anthropicHeaders = jsonHeaders.merging(["anthropic-version": "2023-06-01"]) { _, b in b }

        // Chat = minimal hello. Every other mode swaps in a mode-specific body.
        if mode == "chat" {
            switch providerId {
            case "anthropic":
                return ("https://api.anthropic.com/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}")
            case "openai":
                return ("https://api.openai.com/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"Say hi in one word.\"}]}")
            case "gemini":
                return ("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent", "POST", jsonHeaders,
                    "{\"contents\":[{\"parts\":[{\"text\":\"Say hi in one word.\"}]}]}")
            default: return (nil, "POST", [:], nil)
            }
        }

        if mode == "stream" {
            switch providerId {
            case "anthropic":
                return ("https://api.anthropic.com/v1/messages", "POST", anthropicHeaders,
                    "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":32,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}]}")
            case "openai":
                return ("https://api.openai.com/v1/chat/completions", "POST", jsonHeaders,
                    "{\"model\":\"gpt-4o-mini\",\"max_tokens\":32,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with OK.\"}]}")
            default: return (nil, "POST", [:], nil)
            }
        }

        if mode == "vision" {
            switch providerId {
            case "anthropic":
                let body = "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"\(pixelPngB64)\"}},{\"type\":\"text\",\"text\":\"What do you see? One short sentence.\"}]}]}"
                return ("https://api.anthropic.com/v1/messages", "POST", anthropicHeaders, body)
            case "openai":
                let body = "{\"model\":\"gpt-4o-mini\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,\(pixelPngB64)\"}},{\"type\":\"text\",\"text\":\"What do you see? One short sentence.\"}]}]}"
                return ("https://api.openai.com/v1/chat/completions", "POST", jsonHeaders, body)
            case "gemini":
                let body = "{\"contents\":[{\"parts\":[{\"inline_data\":{\"mime_type\":\"image/png\",\"data\":\"\(pixelPngB64)\"}},{\"text\":\"What do you see? One short sentence.\"}]}]}"
                return ("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent", "POST", jsonHeaders, body)
            default: return (nil, "POST", [:], nil)
            }
        }

        if mode == "tools" {
            switch providerId {
            case "anthropic":
                let body = "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":256,\"tools\":[{\"name\":\"get_weather\",\"description\":\"Get weather for a city.\",\"input_schema\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}],\"messages\":[{\"role\":\"user\",\"content\":\"What's the weather in Tokyo right now?\"}]}"
                return ("https://api.anthropic.com/v1/messages", "POST", anthropicHeaders, body)
            case "openai":
                let body = "{\"model\":\"gpt-4o-mini\",\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get weather.\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}],\"messages\":[{\"role\":\"user\",\"content\":\"What's the weather in Tokyo?\"}]}"
                return ("https://api.openai.com/v1/chat/completions", "POST", jsonHeaders, body)
            default: return (nil, "POST", [:], nil)
            }
        }

        if mode == "structured" {
            switch providerId {
            case "openai":
                let body = "{\"model\":\"gpt-4o-mini\",\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"user\",\"content\":\"Return JSON: {\\\"status\\\":\\\"ok\\\"}. Only the JSON.\"}]}"
                return ("https://api.openai.com/v1/chat/completions", "POST", jsonHeaders, body)
            case "anthropic":
                let body = "{\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"Return ONLY this JSON and nothing else: {\\\"status\\\":\\\"ok\\\"}\"}]}"
                return ("https://api.anthropic.com/v1/messages", "POST", anthropicHeaders, body)
            default: return (nil, "POST", [:], nil)
            }
        }

        return (nil, "POST", [:], nil)
    }

    /// Mode-specific shape check. Returns (ok, note) — the note is echoed in
    /// the result JSON so the orchestrator can see *why* a mode failed even
    /// when the underlying HTTP 200 would otherwise look like success.
    private static func validatePayloadShape(mode: String, providerId: String, status: Int, body: String) -> (Bool, String?) {
        if status < 200 || status >= 400 || body.isEmpty { return (false, "http-\(status)") }
        switch mode {
        case "stream":
            let isSse = body.contains("data:") || body.contains("event:")
            return (isSse, isSse ? "sse-framed" : "no-sse-markers")
        case "tools":
            let hasAnthropicTool = providerId == "anthropic" && body.contains("tool_use")
            let hasOpenaiTool = providerId == "openai" && body.contains("tool_calls")
            let ok = hasAnthropicTool || hasOpenaiTool
            return (ok, ok ? "tool-call-present" : "no-tool-call")
        case "structured":
            // The model's JSON reply is escaped inside the envelope's string
            // content field, so the raw body bytes contain `\"status\":\"ok\"`
            // with backslash escapes. Looking for literal "status" misses
            // that form — fall back to unquoted substrings, which match both
            // the escaped (string-embedded) and unescaped shapes.
            let hasJson = body.contains("status") && body.contains("ok")
            return (hasJson, hasJson ? "json-key-present" : "missing-status-key")
        case "vision", "chat":
            return (true, nil)
        default:
            return (true, nil)
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
                .preferredColorScheme(.light)
                .onOpenURL { url in
                    handleIncomingURL(url)
                }
                .onAppear {
                    checkClipboardForDeferredGift()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { checkClipboardForDeferredGift() }
        }
    }

    private func handleIncomingURL(_ url: URL) {
        guard url.scheme == "byoky" else { return }
        // byoky://gift/<encoded> — host is "gift", path holds the payload.
        // Absolute fallback: stash the whole URL string so RedeemGiftView's
        // existing parser can strip the prefix.
        if url.host == "gift" {
            wallet.pendingGiftLink = url.absoluteString
        } else if url.host == "pair" {
            wallet.pendingPairLink = url.absoluteString
        }
    }

    // Deferred deep linking: if the web redeem page was opened, it copied the
    // gift URL to the clipboard before redirecting to the App Store. When the
    // user installs Byoky and foregrounds it for the first time, we pick up
    // the pasted URL so the gift isn't lost. Runs at most once per launch.
    private func checkClipboardForDeferredGift() {
        guard !hasCheckedClipboardForGift else { return }
        hasCheckedClipboardForGift = true
        guard wallet.pendingGiftLink == nil else { return }
        guard UIPasteboard.general.hasStrings else { return }
        guard let text = UIPasteboard.general.string else { return }
        if text.hasPrefix("https://byoky.com/gift") || text.hasPrefix("byoky://gift") {
            wallet.pendingGiftLink = text
            UIPasteboard.general.string = ""
        }
    }
}
