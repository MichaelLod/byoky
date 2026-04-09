import XCTest
@testable import Byoky

/// Live smoke tests against real provider APIs on iOS.
///
/// Each test:
///   1. Uses TranslationEngine to translate a tiny anthropic-dialect request
///      into the target family's dialect.
///   2. Sends that translated body to the real provider via URLSession.
///   3. Translates the response back through the engine.
///   4. Asserts the round-trip parses cleanly.
///
/// Tests are gated behind environment variables. Skipped (XCTSkip) if a key
/// isn't set, so absence is non-fatal.
///
/// Run with all four families:
///   export BYOKY_TEST_ANTHROPIC_KEY=sk-ant-...
///   export BYOKY_TEST_OPENAI_KEY=sk-...
///   export BYOKY_TEST_GEMINI_KEY=AIza...
///   export BYOKY_TEST_COHERE_KEY=...
///   xcodebuild test -scheme Byoky -destination 'platform=iOS Simulator,name=iPhone 16'
///
/// Live tests are slow and rate-limited. Run sparingly.
final class TranslationLiveSmokeTest: XCTestCase {

    private let anthropicReqBody = """
    {"model":"claude-haiku-4-5-20251001","max_tokens":50,\
    "messages":[{"role":"user","content":"Reply with the single word: pong"}]}
    """

    func testAnthropicNativeRoundTrip() async throws {
        let key = try requireEnv("BYOKY_TEST_ANTHROPIC_KEY")
        let ctxJson = """
        {"srcFamily":"anthropic","dstFamily":"anthropic",\
        "srcProviderId":"anthropic","dstProviderId":"anthropic",\
        "srcModel":"claude-haiku-4-5-20251001","dstModel":"claude-haiku-4-5-20251001"}
        """

        let translated = try TranslationEngine.shared.translateRequest(
            contextJson: ctxJson,
            body: anthropicReqBody
        )
        let response = try await postJson(
            url: URL(string: "https://api.anthropic.com/v1/messages")!,
            body: translated,
            headers: [
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            ]
        )
        let parsed = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any]
        )
        XCTAssertNotNil(parsed["content"], "anthropic response missing content[]")
    }

    func testOpenaiCrossFamilyRoundTrip() async throws {
        let key = try requireEnv("BYOKY_TEST_OPENAI_KEY")
        let ctxJson = """
        {"srcFamily":"anthropic","dstFamily":"openai",\
        "srcProviderId":"anthropic","dstProviderId":"openai",\
        "srcModel":"claude-haiku-4-5-20251001","dstModel":"gpt-4o-mini"}
        """

        let translatedReq = try TranslationEngine.shared.translateRequest(
            contextJson: ctxJson,
            body: anthropicReqBody
        )
        let raw = try await postJson(
            url: URL(string: "https://api.openai.com/v1/chat/completions")!,
            body: translatedReq,
            headers: ["Authorization": "Bearer \(key)"]
        )
        let translated = try TranslationEngine.shared.translateResponse(
            contextJson: ctxJson,
            body: raw
        )
        let parsed = try JSONSerialization.jsonObject(with: Data(translated.utf8)) as? [String: Any]
        XCTAssertNotNil(parsed?["content"], "translated response missing content[]")
    }

    func testGeminiCrossFamilyRoundTrip() async throws {
        let key = try requireEnv("BYOKY_TEST_GEMINI_KEY")
        let ctxJson = """
        {"srcFamily":"anthropic","dstFamily":"gemini",\
        "srcProviderId":"anthropic","dstProviderId":"gemini",\
        "srcModel":"claude-haiku-4-5-20251001","dstModel":"gemini-2.5-flash"}
        """

        let translatedReq = try TranslationEngine.shared.translateRequest(
            contextJson: ctxJson,
            body: anthropicReqBody
        )
        let raw = try await postJson(
            url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent")!,
            body: translatedReq,
            headers: ["x-goog-api-key": key]
        )
        let translated = try TranslationEngine.shared.translateResponse(
            contextJson: ctxJson,
            body: raw
        )
        let parsed = try JSONSerialization.jsonObject(with: Data(translated.utf8)) as? [String: Any]
        XCTAssertNotNil(parsed?["content"], "translated response missing content[]")
    }

    func testCohereCrossFamilyRoundTrip() async throws {
        let key = try requireEnv("BYOKY_TEST_COHERE_KEY")
        let ctxJson = """
        {"srcFamily":"anthropic","dstFamily":"cohere",\
        "srcProviderId":"anthropic","dstProviderId":"cohere",\
        "srcModel":"claude-haiku-4-5-20251001","dstModel":"command-r-plus"}
        """

        let translatedReq = try TranslationEngine.shared.translateRequest(
            contextJson: ctxJson,
            body: anthropicReqBody
        )
        let raw = try await postJson(
            url: URL(string: "https://api.cohere.com/v2/chat")!,
            body: translatedReq,
            headers: ["Authorization": "Bearer \(key)"]
        )
        let translated = try TranslationEngine.shared.translateResponse(
            contextJson: ctxJson,
            body: raw
        )
        let parsed = try JSONSerialization.jsonObject(with: Data(translated.utf8)) as? [String: Any]
        XCTAssertNotNil(parsed?["content"], "translated response missing content[]")
    }

    // MARK: - Helpers

    private func requireEnv(_ name: String) throws -> String {
        guard let v = ProcessInfo.processInfo.environment[name], !v.isEmpty else {
            throw XCTSkip("\(name) not set")
        }
        return v
    }

    private func postJson(url: URL, body: String, headers: [String: String]) async throws -> String {
        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = "POST"
        request.httpBody = Data(body.utf8)
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try XCTUnwrap(response as? HTTPURLResponse)
        let text = String(data: data, encoding: .utf8) ?? ""
        XCTAssertTrue(
            (200..<300).contains(http.statusCode),
            "upstream HTTP \(http.statusCode): \(text.prefix(200))"
        )
        return text
    }
}
