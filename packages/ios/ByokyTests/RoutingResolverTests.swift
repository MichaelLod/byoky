import XCTest
@testable import Byoky

/// Routing decisions that depend on the group's pin and on Gemini's
/// URL-borne model and streaming flag. Reference: resolveRoute in
/// packages/core/src/routing.ts.
final class RoutingResolverTests: XCTestCase {

    private func credential(_ providerId: String, _ label: String) -> Credential {
        Credential.create(providerId: providerId, label: label)
    }

    private func group(_ providerId: String, pin: String? = nil, model: String? = nil) -> Group {
        Group(id: UUID().uuidString, name: "Test", providerId: providerId, credentialId: pin, model: model, createdAt: Date())
    }

    // MARK: - Pins

    func testPinnedKeyIsUsedWhenTheAppCallsTheGroupsProvider() throws {
        let first = credential("anthropic", "Key 1")
        let second = credential("anthropic", "Key 2")
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-5",
            group: group("anthropic", pin: second.id, model: "claude-opus-4-1"),
            credentials: [first, second]
        ))
        XCTAssertEqual(decision.credential.id, second.id)
        XCTAssertNil(decision.translation)
        XCTAssertEqual(decision.modelOverride, "claude-opus-4-1")
    }

    func testUnpinnedGroupUsesAnyKeyOfItsProvider() throws {
        let first = credential("anthropic", "Key 1")
        let second = credential("anthropic", "Key 2")
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: nil,
            group: group("anthropic"), credentials: [first, second]
        ))
        XCTAssertEqual(decision.credential.id, first.id)
    }

    func testStalePinResolvesToNothing() {
        let first = credential("anthropic", "Key 1")
        XCTAssertNil(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: nil,
            group: group("anthropic", pin: "removed-key"), credentials: [first]
        ))
    }

    // MARK: - Gemini

    func testGeminiModelComesFromTheURL() {
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
        XCTAssertEqual(RoutingResolver.geminiModel(fromURL: url), "gemini-2.5-pro")
        XCTAssertEqual(RoutingResolver.requestedModel(body: nil, url: url, providerId: "gemini"), "gemini-2.5-pro")
        XCTAssertEqual(
            RoutingResolver.requestedModel(body: Data(#"{"model":"from-body"}"#.utf8), url: url, providerId: "gemini"),
            "from-body"
        )
        XCTAssertNil(RoutingResolver.requestedModel(body: nil, url: url, providerId: "openai"))
        XCTAssertNil(RoutingResolver.geminiModel(fromURL: "https://generativelanguage.googleapis.com/v1beta/models"))
        XCTAssertNil(RoutingResolver.geminiModel(fromURL: "https://generativelanguage.googleapis.com/v1beta/models/:generateContent"))
    }

    func testGeminiStreamingIsReadFromTheURL() {
        let base = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro"
        XCTAssertTrue(RoutingResolver.isStreamingRequest(body: Data(#"{"contents":[]}"#.utf8), url: base + ":streamGenerateContent?alt=sse"))
        XCTAssertFalse(RoutingResolver.isStreamingRequest(body: Data(#"{"contents":[]}"#.utf8), url: base + ":generateContent"))
        XCTAssertTrue(RoutingResolver.isStreamingRequest(body: Data(#"{"stream":true}"#.utf8), url: "https://api.openai.com/v1/chat/completions"))
        XCTAssertFalse(RoutingResolver.isStreamingRequest(body: nil))
    }

    /// Translation and swaps rewrite the request onto the destination's chat
    /// endpoint, so only chat requests may be routed; the proxy answers
    /// anything else with ROUTING_UNSUPPORTED.
    func testOnlyChatRequestsCanBeRouted() {
        let engine = TranslationEngine.shared
        let gemini = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro"
        XCTAssertTrue(engine.isChatEndpoint(providerId: "gemini", url: gemini + ":generateContent"))
        XCTAssertTrue(engine.isChatEndpoint(providerId: "gemini", url: gemini + ":streamGenerateContent?alt=sse"))
        XCTAssertFalse(engine.isChatEndpoint(providerId: "gemini", url: gemini + ":countTokens"))
        XCTAssertTrue(engine.isChatEndpoint(providerId: "anthropic", url: "https://api.anthropic.com/v1/messages"))
        XCTAssertFalse(engine.isChatEndpoint(providerId: "anthropic", url: "https://api.anthropic.com/v1/messages/count_tokens"))
        XCTAssertTrue(engine.isChatEndpoint(providerId: "groq", url: "https://api.groq.com/openai/v1/chat/completions"))
        XCTAssertFalse(engine.isChatEndpoint(providerId: "openai", url: "https://api.openai.com/v1/embeddings"))
        XCTAssertFalse(engine.isChatEndpoint(providerId: "openai", url: "https://api.openai.com/v1/models"))
        XCTAssertFalse(engine.isChatEndpoint(providerId: "nope", url: "https://api.openai.com/v1/chat/completions"))
    }

    /// A Gemini streaming request asks the destination for a stream.
    func testGeminiStreamTranslatesToAStreamingRequest() throws {
        let engine = TranslationEngine.shared
        let ctx = try engine.buildTranslationContext(
            srcProviderId: "gemini", dstProviderId: "anthropic",
            srcModel: "gemini-2.5-flash", dstModel: "claude-sonnet-4-6",
            isStreaming: true, requestId: "r1"
        )
        let body = try engine.translateRequest(contextJson: ctx, body: #"{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}"#)
        let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        XCTAssertEqual(parsed["stream"] as? Bool, true)
    }

    /// A Gemini app with only an Anthropic key gets auto-translated, using
    /// the model named in its URL.
    func testGeminiAppsAreAutoRouted() throws {
        let anthropic = credential("anthropic", "Claude")
        let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "gemini",
            requestedModel: RoutingResolver.requestedModel(body: Data(#"{"contents":[]}"#.utf8), url: url, providerId: "gemini"),
            group: Group.makeDefault(),
            credentials: [anthropic]
        ))
        XCTAssertEqual(decision.credential.id, anthropic.id)
        XCTAssertEqual(decision.translation?.srcModel, "gemini-2.5-flash")
        XCTAssertEqual(decision.translation?.dstProviderId, "anthropic")
    }
}
