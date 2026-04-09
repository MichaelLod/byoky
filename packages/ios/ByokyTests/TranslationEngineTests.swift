import XCTest
@testable import Byoky

/// Bridge tests for the @byoky/core mobile bundle on iOS.
///
/// These run via the Byoky XCTest target on a simulator or device. They
/// exercise the JS engine + handle table without making any network calls,
/// proving the bridge wiring (JSContext → bundle → BYOKY_TRANSLATE global)
/// is correct. The translate logic itself is already covered by 572 unit
/// tests on Node — these tests prove the *bridge* is right, not the rules.
///
/// Setup:
///   The XCTest target doesn't exist in the Xcode project today. To add it:
///   1. Open packages/ios/Byoky.xcodeproj in Xcode
///   2. File → New → Target → iOS → Unit Testing Bundle, name "ByokyTests"
///   3. Set "Target to be Tested" to Byoky
///   4. Drag this file (and TranslationLiveSmokeTest.swift) into the new target
///   5. Ensure mobile.js is in the Byoky target's resources (see commit 9104d45)
///   6. Run via ⌘U or `xcodebuild test -scheme Byoky -destination 'platform=iOS Simulator,name=iPhone 16'`
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
        XCTAssertEqual(TranslationEngine.shared.bundleVersion, "0.5.0")
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
