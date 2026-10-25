import XCTest
@testable import Byoky

/// Bridge tests for the @byoky/core mobile bundle on iOS.
///
/// These run in the ByokyTests target on a simulator or device. They
/// exercise the JS engine + handle table without making any network calls,
/// proving the bridge wiring (JSContext → bundle → BYOKY_TRANSLATE global)
/// is correct. The translate logic itself is covered by the unit tests on
/// Node — these tests prove the *bridge* is right, not the rules.
///
/// Run: `xcodebuild test -scheme Byoky -only-testing:ByokyTests
///       -destination 'platform=iOS Simulator,name=iPhone 18 Pro'`
final class TranslationEngineTests: XCTestCase {

    private let anthropicToOpenaiCtx = """
    {"srcFamily":"anthropic","dstFamily":"openai",\
    "srcProviderId":"anthropic","dstProviderId":"openai",\
    "srcModel":"claude-sonnet-4-5","dstModel":"gpt-4o"}
    """

    private let anthropicReqBody = """
    {"model":"claude-sonnet-4-5","max_tokens":100,\
    "messages":[{"role":"user","content":"hi"}]}
    """

    func testBundleLoadsAndExposesVersion() throws {
        try TranslationEngine.shared.warmUp()
        let version = try XCTUnwrap(TranslationEngine.shared.bundleVersion)
        XCTAssertNotNil(
            version.range(of: #"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$"#, options: .regularExpression),
            "bundle version is not semver: \(version)"
        )
    }

    func testTranslateRequestAnthropicToOpenai() throws {
        let translated = try TranslationEngine.shared.translateRequest(
            contextJson: anthropicToOpenaiCtx,
            body: anthropicReqBody
        )
        let data = Data(translated.utf8)
        let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(parsed["model"] as? String, "gpt-4o")
        let messages = try XCTUnwrap(parsed["messages"] as? [[String: Any]])
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages.first?["role"] as? String, "user")
    }

    func testStreamHandleLifecycle() throws {
        let engine = TranslationEngine.shared
        let handle = try engine.createStreamTranslator(contextJson: anthropicToOpenaiCtx)
        XCTAssertGreaterThan(handle, 0)
        engine.releaseStreamTranslator(handle: handle)
        // After release, flush should error.
        XCTAssertThrowsError(try engine.flushStreamTranslator(handle: handle)) { error in
            XCTAssertTrue(error is TranslationEngine.EngineError)
        }
    }

    func testUnknownStreamHandleErrors() {
        XCTAssertThrowsError(try TranslationEngine.shared.processStreamChunk(handle: 99999, chunk: "data: {}\n\n")) { error in
            XCTAssertTrue(error is TranslationEngine.EngineError)
        }
    }

    func testMalformedContextJsonPropagatesError() {
        XCTAssertThrowsError(try TranslationEngine.shared.translateRequest(
            contextJson: "{ not valid json",
            body: anthropicReqBody
        )) { error in
            XCTAssertTrue(error is TranslationEngine.EngineError)
        }
    }

    /// A TranslationError reaches native code with its code and message,
    /// not as "invalid result".
    func testTranslationErrorsKeepTheirCodeAndMessage() {
        XCTAssertThrowsError(try TranslationEngine.shared.translateRequest(
            contextJson: anthropicToOpenaiCtx,
            body: "{ not json"
        )) { error in
            guard let error = error as? TranslationEngine.EngineError else {
                return XCTFail("unexpected error \(error)")
            }
            XCTAssertEqual(error.pageCode, "INVALID_JSON")
            XCTAssertTrue(error.pageMessage.hasPrefix("Anthropic request body is not valid JSON"), error.pageMessage)
        }
        // A plain JS error has no code of its own.
        XCTAssertThrowsError(try TranslationEngine.shared.translateRequest(contextJson: "{ not valid json", body: anthropicReqBody)) { error in
            XCTAssertEqual((error as? TranslationEngine.EngineError)?.pageCode, "TRANSLATION_FAILED")
        }
        // Nothing is left pending for the next call.
        XCTAssertNoThrow(try TranslationEngine.shared.translateRequest(contextJson: anthropicToOpenaiCtx, body: anthropicReqBody))
    }

    func testSpecialCharactersInBodyHandled() throws {
        let body = """
        {"model":"claude-sonnet-4-5","max_tokens":1,\
        "messages":[{"role":"user","content":"line\\nwith \\"quotes\\" and \\\\ slashes"}]}
        """
        let translated = try TranslationEngine.shared.translateRequest(
            contextJson: anthropicToOpenaiCtx,
            body: body
        )
        let parsed = try JSONSerialization.jsonObject(with: Data(translated.utf8)) as? [String: Any]
        XCTAssertEqual(parsed?["model"] as? String, "gpt-4o")
    }
}
