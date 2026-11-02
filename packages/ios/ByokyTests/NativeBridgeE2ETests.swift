import WebKit
import XCTest
@testable import Byoky

/// The in-wallet browser end to end: a WKWebView on https://app.example runs
/// the production bridge script, posts the SDK's `BYOKY_*` messages and
/// collects the replies from its MessagePort; NativeBridgeHandler proxies the
/// requests to a scripted upstream (`StubUpstream`, a URLProtocol behind
/// ProxyURLSession). Each test creates a fresh wallet in `WalletStore.shared`
/// and resets it afterwards, so it needs a simulator without a wallet.
final class NativeBridgeE2ETests: XCTestCase {

    private static let chatURL = "https://api.openai.com/v1/chat/completions"

    // MARK: - Pass-through

    @MainActor
    func testJSONReplyPassesThrough() async throws {
        let h = try await BridgeHarness.make(self)
        let body = #"{"id":"c1","choices":[{"message":{"role":"assistant","content":"hi ✓"}}],"usage":{"prompt_tokens":7,"completion_tokens":5}}"#
        StubUpstream.script(.init(chunks: [Data(body.utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#)

        XCTAssertEqual(replies.map(\.type), ["BYOKY_PROXY_RESPONSE_META", "BYOKY_PROXY_RESPONSE_CHUNK", "BYOKY_PROXY_RESPONSE_DONE"])
        XCTAssertEqual(replies.first?["status"] as? Int, 200)
        XCTAssertEqual(BridgeHarness.text(of: replies), body)
        // The key is attached natively; the page never had it.
        XCTAssertEqual(StubUpstream.requests.first?.value(forHTTPHeaderField: "Authorization"), "Bearer \(BridgeHarness.apiKey)")
        // Usage was settled against the app's allowance and logged.
        XCTAssertEqual(h.wallet.tokenUsage(for: BridgeHarness.origin), 12)
        XCTAssertEqual(h.wallet.requestLogs.first?.statusCode, 200)
    }

    @MainActor
    func testEventStreamPassesThroughAndEndsWithDone() async throws {
        let h = try await BridgeHarness.make(self)
        let events = ["data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n", "data: [DONE]\n\n"]
        StubUpstream.script(.init(headers: ["Content-Type": "text/event-stream"], chunks: events.map { Data($0.utf8) }))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","stream":true,"messages":[]}"#)

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        XCTAssertEqual(BridgeHarness.text(of: replies), events.joined())
    }

    /// Non-streaming replies send their headers only when generation ends;
    /// the upstream request must allow that much longer than two minutes.
    @MainActor
    func testUpstreamRequestsAllowSlowGenerations() async throws {
        let h = try await BridgeHarness.make(self)
        StubUpstream.script(.init(chunks: [Data("{}".utf8)]))

        _ = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#)

        XCTAssertEqual(StubUpstream.requests.first?.timeoutInterval, 600)
    }

    // MARK: - Connection lost midway (F021)

    @MainActor
    func testStreamCutOffMidwayEndsInAnError() async throws {
        let h = try await BridgeHarness.make(self)
        StubUpstream.script(.init(
            headers: ["Content-Type": "text/event-stream"],
            chunks: [Data("data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n".utf8)],
            failure: .networkConnectionLost
        ))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","stream":true,"messages":[]}"#)

        XCTAssertFalse(replies.contains { $0.type == "BYOKY_PROXY_RESPONSE_DONE" })
        let last = try XCTUnwrap(replies.last)
        XCTAssertEqual(last.type, "BYOKY_PROXY_RESPONSE_ERROR")
        XCTAssertEqual(last["status"] as? Int, 502)
        XCTAssertEqual((last["error"] as? [String: Any])?["code"] as? String, "PROXY_ERROR")
        XCTAssertEqual((last["error"] as? [String: Any])?["message"] as? String, NativeBridgeHandler.connectionLostMessage)
        // What arrived before the drop was still delivered, and logged.
        XCTAssertTrue(BridgeHarness.text(of: replies).contains("\"a\""))
        XCTAssertEqual(h.wallet.requestLogs.first?.statusCode, 200)
    }

    @MainActor
    func testJSONCutOffMidwayEndsInAnError() async throws {
        let h = try await BridgeHarness.make(self)
        StubUpstream.script(.init(chunks: [Data(#"{"id":"c1","choi"#.utf8)], failure: .networkConnectionLost))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#)

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_ERROR")
        XCTAssertFalse(replies.contains { $0.type == "BYOKY_PROXY_RESPONSE_DONE" })
    }

    // MARK: - Binary replies (F026)

    @MainActor
    func testBinaryReplyArrivesByteForByte() async throws {
        let h = try await BridgeHarness.make(self)
        // An MP3 frame header and every byte value, twice: far from UTF-8.
        let audio = Data([0xFF, 0xFB, 0x90, 0x64] + (0...255).map(UInt8.init) + (0...255).map(UInt8.init))
        StubUpstream.script(.init(headers: ["Content-Type": "audio/mpeg"], chunks: [audio.prefix(100), audio.dropFirst(100)].map { Data($0) }))

        let replies = try await h.proxy(
            url: "https://api.openai.com/v1/audio/speech",
            body: #"{"model":"gpt-4o-mini-tts","input":"hi","voice":"alloy"}"#
        )

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        let chunks = replies.filter { $0.type == "BYOKY_PROXY_RESPONSE_CHUNK" }
        XCTAssertFalse(chunks.isEmpty)
        XCTAssertTrue(chunks.allSatisfy { $0["chunkEncoding"] as? String == "base64" })
        let received = chunks.reduce(into: Data()) { out, chunk in
            out.append(Data(base64Encoded: chunk["chunk"] as? String ?? "") ?? Data("!".utf8))
        }
        XCTAssertEqual(received, audio)
    }

    func testTextContentTypes() {
        for type in ["application/json", "text/event-stream; charset=utf-8", "text/plain", "application/problem+json",
                     "application/xml", "application/javascript", "application/x-www-form-urlencoded", ""] {
            XCTAssertTrue(NativeBridgeHandler.isTextContentType(type), type)
        }
        for type in ["audio/mpeg", "audio/wav", "image/png", "application/octet-stream", "application/pdf"] {
            XCTAssertFalse(NativeBridgeHandler.isTextContentType(type), type)
        }
    }

    // MARK: - Cancellation, lock, revoke

    /// Cancelled after the request went out: the provider bills it, so the
    /// estimate is charged and logged as 499, and the page hears nothing more.
    @MainActor
    func testCancelStopsTheUpstreamCall() async throws {
        let h = try await BridgeHarness.make(self)
        StubUpstream.script(.init(hold: true))
        let requestId = "cancel-\(UUID().uuidString.prefix(8))"

        async let replies = h.proxy(body: #"{"model":"gpt-5.5","max_tokens":100,"messages":[]}"#, requestId: requestId, timeoutMs: 1500)
        try await StubUpstream.waitForRequests(1)
        try await h.post(["type": "BYOKY_PROXY_CANCEL", "requestId": requestId])
        let received = try await replies

        XCTAssertEqual(received.count, 0)
        try await StubUpstream.waitForStops(1)
        XCTAssertEqual(h.wallet.requestLogs.first?.statusCode, 499)
        XCTAssertGreaterThan(h.wallet.tokenUsage(for: BridgeHarness.origin), 0)
    }

    /// Cancelled before anything went out: nothing is sent upstream, nothing
    /// is charged or logged, and the reservation is released (F078).
    @MainActor
    func testCancelBeforeSendingChargesNothing() async throws {
        let h = try await BridgeHarness.make(self)
        h.wallet.setAllowance(TokenAllowance(origin: BridgeHarness.origin, totalLimit: 5_000, providerLimits: nil))
        let sessionKey = try await h.connect()
        StubUpstream.script(.init(chunks: [Data("{}".utf8)]))
        let logsBefore = h.wallet.requestLogs.count

        // Both in one main-actor turn: the request's task is cancelled before
        // it gets to run.
        h.handler.handleMessage(type: "BYOKY_PROXY_REQUEST", body: [
            "requestId": "early", "sessionKey": sessionKey, "providerId": "openai",
            "url": Self.chatURL, "method": "POST", "headers": ["content-type": "application/json"],
            "body": #"{"model":"gpt-5.5","max_tokens":4096,"messages":[]}"#,
        ])
        h.handler.handleMessage(type: "BYOKY_PROXY_CANCEL", body: ["requestId": "early"])
        try await Task.sleep(for: .milliseconds(500))

        XCTAssertEqual(StubUpstream.requests.count, 0)
        XCTAssertEqual(h.wallet.requestLogs.count, logsBefore)
        XCTAssertEqual(h.wallet.tokenUsage(for: BridgeHarness.origin), 0)
        // Nothing is still held against the allowance.
        XCTAssertNoThrow(try h.wallet.reserveTokens(origin: BridgeHarness.origin, providerId: "openai", estimatedTokens: 5_000).get())
    }

    @MainActor
    func testLockingTheWalletStopsRequests() async throws {
        let h = try await BridgeHarness.make(self)
        StubUpstream.script(.init(hold: true))

        async let replies = h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#, timeoutMs: 1500)
        try await StubUpstream.waitForRequests(1)
        h.wallet.lock()
        let received = try await replies

        XCTAssertFalse(received.contains { $0.type == "BYOKY_PROXY_RESPONSE_DONE" })
        try await StubUpstream.waitForStops(1)
    }

    @MainActor
    func testRevokedAppGetsSessionExpired() async throws {
        let h = try await BridgeHarness.make(self)
        let sessionKey = try await h.connect()
        let session = try XCTUnwrap(h.wallet.sessions.first { $0.appOrigin == BridgeHarness.origin })
        try h.wallet.revokeSession(session)

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#, sessionKey: sessionKey)

        XCTAssertEqual(replies.map(\.type), ["BYOKY_PROXY_RESPONSE_ERROR"])
        XCTAssertEqual(replies.first?["status"] as? Int, 401)
        XCTAssertEqual((replies.first?["error"] as? [String: Any])?["code"] as? String, "SESSION_EXPIRED")
        XCTAssertEqual(StubUpstream.requests.count, 0)
    }

    // MARK: - Allowances, errors

    /// The first request's usage is settled against the allowance; once it
    /// is used up the next request is refused before it goes out.
    @MainActor
    func testAllowanceIsSettledAndThenEnforced() async throws {
        let h = try await BridgeHarness.make(self)
        h.wallet.setAllowance(TokenAllowance(origin: BridgeHarness.origin, totalLimit: 10, providerLimits: nil))
        StubUpstream.script(.init(chunks: [Data(#"{"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":5}}"#.utf8)]))

        let first = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#)
        XCTAssertEqual(first.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        XCTAssertEqual(h.wallet.tokenUsage(for: BridgeHarness.origin), 12)

        let second = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#)
        XCTAssertEqual(second.first?["status"] as? Int, 429)
        XCTAssertEqual((second.first?["error"] as? [String: Any])?["code"] as? String, "QUOTA_EXCEEDED")
        XCTAssertEqual(StubUpstream.requests.count, 1)
    }

    /// No key can serve the request: the documented PROVIDER_UNAVAILABLE,
    /// status 403, as the extension sends it (F103).
    @MainActor
    func testNoKeyIsProviderUnavailable() async throws {
        // A DeepSeek key can't serve an OpenAI app (same dialect, but no group
        // swaps to it) and auto-routing names no model for DeepSeek.
        let h = try await BridgeHarness.make(self, provider: "deepseek")

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[]}"#)

        XCTAssertEqual(replies.first?["status"] as? Int, 403)
        XCTAssertEqual((replies.first?["error"] as? [String: Any])?["code"] as? String, "PROVIDER_UNAVAILABLE")
    }

    func testProxyErrorStatusesMatchTheExtension() {
        XCTAssertEqual(NativeBridgeHandler.status(forErrorCode: "PROVIDER_UNAVAILABLE"), 403)
        XCTAssertEqual(NativeBridgeHandler.status(forErrorCode: "INVALID_URL"), 403)
        XCTAssertEqual(NativeBridgeHandler.status(forErrorCode: "SESSION_EXPIRED"), 401)
        XCTAssertEqual(NativeBridgeHandler.status(forErrorCode: "QUOTA_EXCEEDED"), 429)
        for code in ["PROXY_ERROR", "TRANSLATION_FAILED", "SWAP_FAILED"] {
            XCTAssertEqual(NativeBridgeHandler.status(forErrorCode: code), 502, code)
        }
    }

    /// The connect reply lists the providers the app asked for (F101).
    @MainActor
    func testConnectListsTheRequestedProviders() async throws {
        let h = try await BridgeHarness.make(self)

        let replies = try await h.send([
            "type": "BYOKY_CONNECT_REQUEST", "requestId": "connect-1",
            "payload": ["providers": [["id": "anthropic", "required": true], ["id": "mistral", "required": false]]],
        ])

        let providers = try XCTUnwrap((replies.first?["payload"] as? [String: Any])?["providers"] as? [String: [String: Any]])
        // Only an OpenAI key: Anthropic is auto-routed to it; Mistral (same
        // dialect as OpenAI, no group) can't be served.
        XCTAssertEqual(providers["anthropic"]?["available"] as? Bool, true)
        XCTAssertEqual(providers["mistral"]?["available"] as? Bool, false)
        XCTAssertNil(providers["openai"])
    }

    // MARK: - Providers without a fixed host (F020)

    /// The SDK's listModels and a createFetch app know only the registry's
    /// placeholder host; the request goes to the credential's endpoint.
    @MainActor
    func testPlaceholderHostGoesToTheCredentialsEndpoint() async throws {
        let h = try await BridgeHarness.make(self, provider: "azure_openai", baseUrl: "https://myres.openai.azure.com")
        StubUpstream.script(.init(chunks: [Data("{}".utf8)]))

        let replies = try await h.proxy(
            providerId: "azure_openai",
            url: "https://YOUR_RESOURCE.openai.azure.com/openai/v1/chat/completions?api-version=preview",
            body: #"{"model":"gpt-5.5","messages":[]}"#
        )

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        XCTAssertEqual(StubUpstream.requests.first?.url?.absoluteString,
                       "https://myres.openai.azure.com/openai/v1/chat/completions?api-version=preview")
        XCTAssertEqual(h.wallet.requestLogs.first?.url, "https://myres.openai.azure.com/openai/v1/chat/completions")
    }

    /// Any other host is still refused.
    @MainActor
    func testAnotherHostIsStillRefused() async throws {
        let h = try await BridgeHarness.make(self, provider: "azure_openai", baseUrl: "https://myres.openai.azure.com")

        let replies = try await h.proxy(
            providerId: "azure_openai",
            url: "https://evil.openai.azure.com/openai/v1/chat/completions",
            body: #"{"model":"gpt-5.5","messages":[]}"#
        )

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_ERROR")
        XCTAssertEqual((replies.last?["error"] as? [String: Any])?["code"] as? String, "INVALID_URL")
        XCTAssertTrue(StubUpstream.requests.isEmpty)
    }

    // MARK: - Pinned model (R3-05)

    /// A group pinning another OpenAI model fits the app's request to it.
    @MainActor
    func testPinnedModelGetsItsRequestRules() async throws {
        try XCTSkipIf(
            TranslationEngine.shared.rewriteRequestModel(dstProviderId: "openai", url: Self.chatURL, body: "{}", model: "gpt-5.5") == nil,
            "the bundled mobile.js has no rewriteRequestModel yet"
        )
        let h = try await BridgeHarness.make(self, pinnedModel: "gpt-5.5")
        StubUpstream.script(.init(chunks: [Data("{}".utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-4.1","max_tokens":64,"temperature":0.5,"messages":[]}"#)

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        let sent = try XCTUnwrap(try JSONSerialization.jsonObject(with: StubUpstream.bodies.first ?? Data()) as? [String: Any])
        XCTAssertEqual(sent["model"] as? String, "gpt-5.5")
        XCTAssertEqual(sent["max_completion_tokens"] as? Int, 64)
        XCTAssertNil(sent["max_tokens"])
        XCTAssertNil(sent["temperature"])
    }

    /// An embeddings call keeps the app's model under a pinned chat model,
    /// which OpenAI would refuse there (F003).
    @MainActor
    func testPinnedModelLeavesEmbeddingsAlone() async throws {
        let h = try await BridgeHarness.make(self, pinnedModel: "gpt-5.5-mini")
        StubUpstream.script(.init(chunks: [Data(#"{"data":[],"usage":{"prompt_tokens":1,"total_tokens":1}}"#.utf8)]))
        let body = #"{"model":"text-embedding-3-small","input":"hello"}"#

        let replies = try await h.proxy(url: "https://api.openai.com/v1/embeddings", body: body)

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        XCTAssertEqual(StubUpstream.bodies.first.map { String(decoding: $0, as: UTF8.self) }, body)
    }

    /// A request the pinned model can't serve gets a clear error and goes nowhere.
    @MainActor
    func testPinnedModelRefusesWhatItCantServe() async throws {
        try XCTSkipIf(
            TranslationEngine.shared.rewriteRequestModel(dstProviderId: "openai", url: Self.chatURL, body: "{}", model: "gpt-5.5") == nil,
            "the bundled mobile.js has no rewriteRequestModel yet"
        )
        let h = try await BridgeHarness.make(self, pinnedModel: "gpt-6-astra")

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[],"tools":[{"type":"function","function":{"name":"f"}}]}"#)

        let last = try XCTUnwrap(replies.last)
        XCTAssertEqual(last.type, "BYOKY_PROXY_RESPONSE_ERROR")
        XCTAssertEqual(last["status"] as? Int, 400)
        XCTAssertEqual((last["error"] as? [String: Any])?["code"] as? String, "UNSUPPORTED_FEATURE")
        XCTAssertTrue(StubUpstream.requests.isEmpty)
    }

    // MARK: - Translation

    /// An OpenAI app routed to Anthropic gets OpenAI-shaped replies.
    @MainActor
    func testTranslatedRequestRoundTrips() async throws {
        let h = try await BridgeHarness.make(self, provider: "anthropic")
        let reply = #"{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hello"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":2}}"#
        StubUpstream.script(.init(chunks: [Data(reply.utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#)

        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        XCTAssertEqual(StubUpstream.requests.first?.url?.absoluteString, "https://api.anthropic.com/v1/messages")
        let sent = try XCTUnwrap(try JSONSerialization.jsonObject(with: StubUpstream.bodies.first ?? Data()) as? [String: Any])
        XCTAssertEqual(sent["model"] as? String, "claude-sonnet-4-6")
        let translated = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(BridgeHarness.text(of: replies).utf8)) as? [String: Any])
        let message = ((translated["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any])
        XCTAssertEqual(message?["content"] as? String, "hello")
    }

    /// A routed request's error that isn't JSON (a gateway's HTML page) is
    /// passed on as sent.
    @MainActor
    func testTranslatedNonJSONErrorPassesThrough() async throws {
        let h = try await BridgeHarness.make(self, provider: "anthropic")
        let html = "<html><body>502 Bad Gateway</body></html>"
        StubUpstream.script(.init(status: 502, headers: ["Content-Type": "text/html"], chunks: [Data(html.utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#)

        XCTAssertEqual(replies.first?["status"] as? Int, 502)
        XCTAssertEqual(BridgeHarness.text(of: replies), html)
        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
    }

    /// A routed request's provider error reaches the app in its own dialect
    /// (F090), as from the extension. Needs core's translateErrorResponse in
    /// the bundled mobile.js.
    @MainActor
    func testTranslatedProviderErrorIsInTheAppsDialect() async throws {
        let h = try await BridgeHarness.make(self, provider: "anthropic")
        let error = #"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#
        let engine = TranslationEngine.shared
        let ctx = try engine.buildTranslationContext(
            srcProviderId: "openai", dstProviderId: "anthropic", srcModel: "gpt-5.5",
            dstModel: "claude-sonnet-4-6", isStreaming: false, requestId: "probe"
        )
        try XCTSkipIf(engine.translateErrorResponse(contextJson: ctx, body: error) == nil,
                      "the bundled mobile.js has no translateErrorResponse yet")
        StubUpstream.script(.init(status: 401, chunks: [Data(error.utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#)

        XCTAssertEqual(replies.first?["status"] as? Int, 401)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(BridgeHarness.text(of: replies).utf8)) as? [String: Any])
        let inner = try XCTUnwrap(body["error"] as? [String: Any])
        XCTAssertEqual(inner["message"] as? String, "invalid x-api-key")
        // R4-04: OpenAI's type for a 401, not Anthropic's authentication_error.
        XCTAssertEqual(inner["type"] as? String, "invalid_request_error")
        XCTAssertNil(body["type"], "an OpenAI error has no top-level type")
    }

    /// R4-04: the type follows the HTTP status, which the handler passes on.
    @MainActor
    func testTranslatedProviderErrorTypeFollowsTheStatus() async throws {
        let h = try await BridgeHarness.make(self, provider: "anthropic")
        let error = #"{"type":"error","error":{"type":"api_error","message":"Service unavailable"}}"#
        try XCTSkipIf(
            TranslationEngine.shared.translateErrorResponse(contextJson: try TranslationEngine.shared.buildTranslationContext(
                srcProviderId: "openai", dstProviderId: "anthropic", srcModel: "gpt-5.5",
                dstModel: "claude-sonnet-4-6", isStreaming: false, requestId: "probe"
            ), body: error) == nil,
            "the bundled mobile.js has no translateErrorResponse yet"
        )
        StubUpstream.script(.init(status: 503, chunks: [Data(error.utf8)]))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#)

        XCTAssertEqual(replies.first?["status"] as? Int, 503)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(BridgeHarness.text(of: replies).utf8)) as? [String: Any])
        let inner = try XCTUnwrap(body["error"] as? [String: Any])
        XCTAssertEqual(inner["type"] as? String, "service_unavailable_error")
    }

    /// A routed request's error body past the translation limit is passed
    /// on as it arrives, not first read whole into memory (R2-05).
    @MainActor
    func testOversizedTranslatedErrorIsPassedOnAsItArrives() async throws {
        // A smaller limit than the default 1 MiB keeps the test quick.
        let limit = 100_000
        let h = try await BridgeHarness.make(self, provider: "anthropic", maxTranslatedErrorBytes: limit)
        let filler = String(repeating: "é", count: limit / 2 + 50_000)
        let error = #"{"type":"error","error":{"type":"invalid_request_error","message":""# + filler + #""}}"#
        let bytes = Data(error.utf8)
        // Delivered by the stub in 16 KiB pieces, as from a network.
        let pieces = stride(from: 0, to: bytes.count, by: 16_384).map { bytes.subdata(in: $0..<min($0 + 16_384, bytes.count)) }
        StubUpstream.script(.init(status: 400, chunks: pieces))

        let replies = try await h.proxy(body: #"{"model":"gpt-5.5","messages":[{"role":"user","content":"hi"}]}"#, timeoutMs: 30_000)

        XCTAssertEqual(replies.first?["status"] as? Int, 400)
        XCTAssertEqual(replies.last?.type, "BYOKY_PROXY_RESPONSE_DONE")
        let chunks = replies.filter { $0.type == "BYOKY_PROXY_RESPONSE_CHUNK" }.compactMap { $0["chunk"] as? String }
        XCTAssertEqual(chunks.joined(), error, "passed on as sent, multi-byte characters intact")
        XCTAssertGreaterThan(chunks.count, 1)
        let first = try XCTUnwrap(chunks.first)
        XCTAssertLessThanOrEqual(first.utf8.count, limit + 65_536, "held no more than the limit plus one read")
    }

    /// The error-body holder: within the limit it is translated, past it
    /// passed on as sent from the moment it crosses (R2-05).
    func testTranslatedErrorBodyHoldsOnlyUpToItsLimit() {
        var small = TranslatedErrorBody(limit: 8)
        XCTAssertEqual(small.append(Data("{\"e\":".utf8)), "")
        XCTAssertEqual(small.append(Data("1}".utf8)), "")
        XCTAssertEqual(small.finish { "translated:" + $0 }, "translated:{\"e\":1}")

        var untranslatable = TranslatedErrorBody(limit: 8)
        XCTAssertEqual(untranslatable.append(Data("<html>".utf8)), "")
        XCTAssertEqual(untranslatable.finish { _ in nil }, "<html>")

        var large = TranslatedErrorBody(limit: 8)
        let body = Data("0123456789é-tail".utf8)
        XCTAssertEqual(large.append(body.prefix(5)), "")
        // Crosses the limit in the middle of "é": what's complete goes out.
        XCTAssertEqual(large.append(body.subdata(in: 5..<11)), "0123456789")
        XCTAssertEqual(large.append(body.subdata(in: 11..<body.count)), "é-tail")
        XCTAssertEqual(large.finish { _ in XCTFail("never translated"); return nil }, "")
    }
}

// MARK: - Harness

/// One app page in a WKWebView with the bridge, plus a fresh wallet.
@MainActor
final class BridgeHarness: NSObject, WKNavigationDelegate {
    static let origin = "https://app.example"
    static let apiKey = "sk-test-e2e-0123456789"

    let wallet: WalletStore
    let handler: NativeBridgeHandler
    let webView: WKWebView
    private var loaded: CheckedContinuation<Void, Never>?
    private var sessionKey: String?

    /// A wallet with one `provider` key and, for providers other than
    /// OpenAI, a group routing the app to it (cross-family translation).
    /// `baseUrl` is the key's endpoint (Azure, local servers); `pinnedModel`
    /// puts the app in a group on `provider` pinning that model.
    static func make(
        _ test: XCTestCase,
        provider: String = "openai",
        baseUrl: String? = nil,
        pinnedModel: String? = nil,
        maxTranslatedErrorBytes: Int = NativeBridgeHandler.defaultMaxTranslatedErrorBytes
    ) async throws -> BridgeHarness {
        let wallet = WalletStore.shared
        try XCTSkipUnless(wallet.status == .uninitialized, "needs a simulator without a wallet")
        try wallet.createPassword("e2e-\(UUID().uuidString)")
        StubUpstream.reset()
        let harness = BridgeHarness(wallet: wallet, maxTranslatedErrorBytes: maxTranslatedErrorBytes)
        test.addTeardownBlock { @MainActor in
            harness.handler.close()
            harness.webView.removeFromSuperview()
            WalletStore.shared.resetWallet()
            StubUpstream.reset()
        }
        try wallet.addCredential(providerId: provider, label: "Test", apiKey: apiKey, baseUrl: baseUrl)
        if let pinnedModel {
            let group = try wallet.createGroup(name: "Pinned", providerId: provider, model: pinnedModel)
            try wallet.setAppGroup(origin: origin, groupId: group.id)
        } else if provider == "anthropic" {
            let group = try wallet.createGroup(name: "To Claude", providerId: "anthropic", model: "claude-sonnet-4-6")
            try wallet.setAppGroup(origin: origin, groupId: group.id)
        }
        await harness.load()
        return harness
    }

    private init(wallet: WalletStore, maxTranslatedErrorBytes: Int) {
        self.wallet = wallet
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubUpstream.self]
        handler = NativeBridgeHandler(
            wallet: wallet, appOrigin: Self.origin, upstream: ProxyURLSession(configuration: configuration),
            maxTranslatedErrorBytes: maxTranslatedErrorBytes
        )
        let config = WKWebViewConfiguration()
        config.userContentController.addUserScript(WKUserScript(
            source: AppWebView.bridgeJavaScript, injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))
        config.userContentController.add(handler, name: "byoky")
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 10, height: 10), configuration: config)
        super.init()
        webView.navigationDelegate = self
        handler.attach(to: webView)
        // Keep the page in a window so its timers and message ports run.
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first }.first
        window?.addSubview(webView)
    }

    private func load() async {
        await withCheckedContinuation { continuation in
            loaded = continuation
            webView.loadHTMLString(Self.page, baseURL: URL(string: Self.origin + "/")!)
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            loaded?.resume()
            loaded = nil
        }
    }

    /// Post `message` with a MessagePort, as the SDK does, and collect the
    /// replies until a terminal one or `timeoutMs`.
    func send(_ message: [String: Any], timeoutMs: Int = 5_000) async throws -> [[String: Any]] {
        let result = try await webView.callAsyncJavaScript(
            "return await window.__send(message, timeoutMs);",
            arguments: ["message": message, "timeoutMs": timeoutMs],
            in: nil, contentWorld: .page
        )
        let json = try XCTUnwrap(result as? String)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]])
    }

    /// Post `message` without waiting for replies.
    func post(_ message: [String: Any]) async throws {
        _ = try await webView.callAsyncJavaScript(
            "window.postMessage(message, '*'); return 'ok';",
            arguments: ["message": message], in: nil, contentWorld: .page
        )
    }

    func connect() async throws -> String {
        if let sessionKey { return sessionKey }
        let replies = try await send(["type": "BYOKY_CONNECT_REQUEST", "requestId": "connect-\(UUID().uuidString.prefix(8))", "payload": [:]])
        let key = try XCTUnwrap((replies.first?["payload"] as? [String: Any])?["sessionKey"] as? String)
        sessionKey = key
        return key
    }

    func proxy(
        providerId: String = "openai",
        url: String = "https://api.openai.com/v1/chat/completions",
        body: String,
        requestId: String = "req-\(UUID().uuidString.prefix(8))",
        sessionKey: String? = nil,
        timeoutMs: Int = 5_000
    ) async throws -> [[String: Any]] {
        let key: String
        if let sessionKey { key = sessionKey } else { key = try await connect() }
        return try await send([
            "type": "BYOKY_PROXY_REQUEST", "requestId": requestId, "sessionKey": key,
            "providerId": providerId, "url": url, "method": "POST",
            "headers": ["content-type": "application/json"], "body": body,
        ], timeoutMs: timeoutMs)
    }

    /// The text of a reply's chunks, in order.
    static func text(of replies: [[String: Any]]) -> String {
        replies.filter { $0.type == "BYOKY_PROXY_RESPONSE_CHUNK" }.compactMap { $0["chunk"] as? String }.joined()
    }

    private static let page = """
    <!doctype html><html><head><script>
    window.__send = function (message, timeoutMs) {
      return new Promise(function (resolve) {
        var channel = new MessageChannel();
        var replies = [];
        var terminal = { BYOKY_CONNECT_RESPONSE: 1, BYOKY_ERROR: 1, BYOKY_PROXY_RESPONSE_DONE: 1,
          BYOKY_PROXY_RESPONSE_ERROR: 1, BYOKY_SESSION_STATUS_RESPONSE: 1, BYOKY_SESSION_USAGE_RESPONSE: 1 };
        var timer = setTimeout(function () { resolve(JSON.stringify(replies)); }, timeoutMs);
        channel.port1.onmessage = function (event) {
          replies.push(event.data);
          if (terminal[event.data.type]) { clearTimeout(timer); resolve(JSON.stringify(replies)); }
        };
        window.postMessage(message, '*', [channel.port2]);
      });
    };
    </script></head><body>app</body></html>
    """
}

private extension Dictionary where Key == String, Value == Any {
    var type: String? { self["type"] as? String }
}

// MARK: - Scripted upstream

/// Answers ProxyURLSession's requests from a script: status and headers, the
/// body in chunks, then a clean end, a network error, or no answer at all
/// until the request is cancelled.
final class StubUpstream: URLProtocol {
    struct Reply {
        var status = 200
        var headers = ["Content-Type": "application/json"]
        var chunks: [Data] = []
        var failure: URLError.Code?
        /// Never answer; the request stays open until cancelled.
        var hold = false
    }

    private static let lock = NSLock()
    private static var reply = Reply()
    private static var seen: [URLRequest] = []
    private static var seenBodies: [Data] = []
    private static var stops = 0

    static func script(_ reply: Reply) { lock.withLock { self.reply = reply } }
    static func reset() { lock.withLock { reply = Reply(); seen = []; seenBodies = []; stops = 0 } }
    static var requests: [URLRequest] { lock.withLock { seen } }
    static var bodies: [Data] { lock.withLock { seenBodies } }
    static var stopCount: Int { lock.withLock { stops } }

    static func waitForRequests(_ count: Int) async throws {
        try await waitUntil { requests.count >= count }
    }

    static func waitForStops(_ count: Int) async throws {
        try await waitUntil { stopCount >= count }
    }

    private static func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("timed out")
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = Self.readBody(of: request)
        let reply = Self.lock.withLock { () -> Reply in
            Self.seen.append(request)
            Self.seenBodies.append(body)
            return Self.reply
        }
        guard !reply.hold, let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers) else { return }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in reply.chunks { client?.urlProtocol(self, didLoad: chunk) }
        if let failure = reply.failure {
            // As on a real connection, what arrived is read before the drop.
            Thread.sleep(forTimeInterval: 0.3)
            client?.urlProtocol(self, didFailWithError: URLError(failure))
        } else {
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {
        Self.lock.withLock { Self.stops += 1 }
    }

    private static func readBody(of request: URLRequest) -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
