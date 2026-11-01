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

    // MARK: - Pins must belong to the group's provider (F010)

    func testAPinToAnotherProvidersKeyIsNeverUsed() throws {
        let claude = credential("anthropic", "Claude")
        let openai = credential("openai", "OpenAI")
        // Cross-family: the group binds Anthropic but pins the OpenAI key.
        XCTAssertNil(RoutingResolver.resolve(
            requestedProviderId: "gemini", requestedModel: "gemini-2.5-pro",
            group: group("anthropic", pin: openai.id, model: "claude-sonnet-4-6"), credentials: [claude, openai]
        ))
        // Same-family swap: the group binds Groq but pins the OpenAI key; the
        // app's own key serves its own provider instead.
        let swap = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "openai", requestedModel: "gpt-5.5",
            group: group("groq", pin: openai.id), credentials: [openai]
        ))
        XCTAssertNil(swap.swapToProviderId)
        XCTAssertEqual(swap.credential.id, openai.id)
        // Direct: the group binds OpenAI but pins the Anthropic key.
        XCTAssertNil(RoutingResolver.resolve(
            requestedProviderId: "openai", requestedModel: "gpt-5.5",
            group: group("openai", pin: claude.id), credentials: [claude, openai]
        ))
    }

    // MARK: - Routing models from core (F015, F099, F100)

    func testAutoRoutingUsesCoresModel() throws {
        let openai = credential("openai", "OpenAI")
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: Group.makeDefault(), credentials: [openai]
        ))
        XCTAssertEqual(decision.translation?.dstModel, "gpt-5.5")
        XCTAssertEqual(TranslationEngine.shared.autoRouteModel(for: "openrouter"), "openai/gpt-5.5")
    }

    func testAutoRoutingSkipsProvidersCoreNamesNoModelFor() throws {
        let deepseek = credential("deepseek", "DeepSeek")
        let ollama = Credential.create(providerId: "ollama", label: "Local", baseUrl: "http://localhost:11434")
        XCTAssertNil(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: nil, credentials: [deepseek, ollama]
        ))
        let openai = credential("openai", "OpenAI")
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: nil, credentials: [deepseek, ollama, openai]
        ))
        XCTAssertEqual(decision.credential.id, openai.id)
    }

    func testAModelLessCrossFamilyGroupUsesTheProvidersRoutingModel() throws {
        let claude = credential("anthropic", "Claude")
        let openai = credential("openai", "OpenAI")
        let decision = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: group("openai"), credentials: [claude, openai]
        ))
        XCTAssertEqual(decision.credential.id, openai.id)
        XCTAssertEqual(decision.translation?.dstModel, "gpt-5.5")
    }

    func testAModelLessGroupWithoutARoutingDefaultAsksForAModel() {
        let deepseek = credential("deepseek", "DeepSeek")
        XCTAssertNil(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: group("deepseek"), credentials: [deepseek]
        ))
        XCTAssertEqual(
            RoutingResolver.noCredentialMessage(requestedProviderId: "anthropic", userCredentialProviderIds: ["deepseek"], group: group("deepseek")),
            "This app's group routes it to deepseek, which needs a model to translate anthropic requests. Set a model on the group."
        )
    }

    // MARK: - Local servers (F032)

    func testGroupsBoundToALocalServerRoute() throws {
        let ollama = Credential.create(providerId: "ollama", label: "Local", baseUrl: "http://localhost:11434")
        let openai = credential("openai", "OpenAI")
        let swap = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "openai", requestedModel: "gpt-5.5",
            group: group("ollama", model: "llama3.1"), credentials: [ollama, openai]
        ))
        XCTAssertEqual(swap.swapToProviderId, "ollama")
        XCTAssertEqual(swap.swapDstModel, "llama3.1")
        let translated = try XCTUnwrap(RoutingResolver.resolve(
            requestedProviderId: "anthropic", requestedModel: "claude-sonnet-4-6",
            group: group("ollama", model: "llama3.1"), credentials: [ollama]
        ))
        XCTAssertEqual(translated.translation?.dstProviderId, "ollama")
        XCTAssertEqual(
            TranslationEngine.shared.rewriteProxyUrl(dstProviderId: "ollama", model: "llama3.1", stream: false, overrideBaseUrl: "http://localhost:11434"),
            "http://localhost:11434/v1/chat/completions"
        )
    }

    // MARK: - Connect availability (F101)

    func testCanServeFollowsRoutingWithoutAModel() {
        let openai = credential("openai", "OpenAI")
        // OpenAI key only, no group: an Anthropic app is auto-routed.
        XCTAssertEqual(RoutingResolver.canServe(providerId: "anthropic", group: nil, credentials: [openai])?.id, openai.id)
        // A pin to a key that's gone can't serve its provider.
        XCTAssertNil(RoutingResolver.canServe(providerId: "openai", group: group("openai", pin: "gone"), credentials: [openai]))
    }

    func testConnectListsEveryRequestedProvider() {
        let openai = credential("openai", "OpenAI")
        let requested = NativeBridgeHandler.requestedProviderIds([
            ["id": "anthropic", "required": true], "mistral", ["id": "Bad Id"], 42,
        ])
        XCTAssertEqual(requested, ["anthropic", "mistral"])
        let result = NativeBridgeHandler.connectProviders(requested: requested, credentials: [openai]) { id in
            RoutingResolver.canServe(providerId: id, group: nil, credentials: [openai])
        }
        XCTAssertEqual(result.providers["anthropic"]?["available"] as? Bool, true)
        XCTAssertEqual(result.providers["anthropic"]?["authMethod"] as? String, "api_key")
        // Same dialect as OpenAI but no group swaps to it: unavailable.
        XCTAssertEqual(result.providers["mistral"]?["available"] as? Bool, false)
        XCTAssertNil(result.providers["openai"])
        XCTAssertEqual(result.sessionProviders, ["anthropic"])

        // No providers named: the wallet's own providers, as before.
        let all = NativeBridgeHandler.connectProviders(requested: [], credentials: [openai]) { _ in nil }
        XCTAssertEqual(all.providers["openai"]?["available"] as? Bool, true)
        XCTAssertEqual(all.sessionProviders, ["openai"])
    }
}
