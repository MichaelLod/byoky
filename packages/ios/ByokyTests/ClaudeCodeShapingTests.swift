import XCTest
@testable import Byoky

/// Setup-token (OAuth) request shaping in the in-wallet browser. Expected
/// values were computed from packages/core/dist with the extension's
/// semantics (rewriteToolNamesForClaudeCode, then injectClaudeCodeSystemPrompt
/// with relocateExisting only when tools were renamed; buildHeaders).
final class ClaudeCodeShapingTests: XCTestCase {
    private let prefix = "You are Claude Code, Anthropic's official CLI for Claude."

    // MARK: - Body

    func testNoSystemGetsThePrefix() throws {
        let shaped = ClaudeCodeShaping.shape(body: #"{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}"#)
        XCTAssertEqual(shaped.toolNameMap, [:])
        try assertJSON(shaped.body, equals: #"{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}],"system":"You are Claude Code, Anthropic's official CLI for Claude."}"#)
    }

    func testStringSystemIsPrefixedNotRelocated() throws {
        let shaped = ClaudeCodeShaping.shape(body: #"{"model":"m","system":"Be terse.","messages":[{"role":"user","content":"hi"}]}"#)
        XCTAssertEqual(shaped.toolNameMap, [:])
        try assertJSON(shaped.body, equals: #"{"model":"m","system":"You are Claude Code, Anthropic's official CLI for Claude.\n\nBe terse.","messages":[{"role":"user","content":"hi"}]}"#)
    }

    func testArraySystemGetsAPrefixBlock() throws {
        let shaped = ClaudeCodeShaping.shape(body: #"{"model":"m","system":[{"type":"text","text":"A"},{"type":"text","text":"B"}],"messages":[{"role":"user","content":"hi"}]}"#)
        XCTAssertEqual(shaped.toolNameMap, [:])
        try assertJSON(shaped.body, equals: #"{"model":"m","system":[{"type":"text","text":"You are Claude Code, Anthropic's official CLI for Claude."},{"type":"text","text":"A"},{"type":"text","text":"B"}],"messages":[{"role":"user","content":"hi"}]}"#)
    }

    func testClaudeCodeToolNamesAreLeftAlone() throws {
        let shaped = ClaudeCodeShaping.shape(body: #"{"model":"m","system":"Sys","tools":[{"name":"Read","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}"#)
        XCTAssertEqual(shaped.toolNameMap, [:])
        try assertJSON(shaped.body, equals: #"{"model":"m","system":"You are Claude Code, Anthropic's official CLI for Claude.\n\nSys","tools":[{"name":"Read","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}"#)
    }

    func testThirdPartyToolsAreRenamedAndSystemRelocated() throws {
        let shaped = ClaudeCodeShaping.shape(body: #"{"model":"m","system":"Framework prompt","tools":[{"name":"read_file","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}"#)
        XCTAssertEqual(shaped.toolNameMap, ["ReadFile": "read_file"])
        try assertJSON(shaped.body, equals: #"{"model":"m","system":"You are Claude Code, Anthropic's official CLI for Claude.","tools":[{"name":"ReadFile","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"<system_context>\nFramework prompt\n</system_context>\n\nhi"}]}"#)
    }

    func testOnlyAnthropicSetupTokensAreShaped() {
        XCTAssertTrue(ClaudeCodeShaping.applies(providerId: "anthropic", authMethod: .oauth))
        XCTAssertFalse(ClaudeCodeShaping.applies(providerId: "anthropic", authMethod: .apiKey))
        XCTAssertFalse(ClaudeCodeShaping.applies(providerId: "openai", authMethod: .oauth))
    }

    // MARK: - Response

    func testJSONResponseGetsOriginalToolNames() throws {
        let rewriter = try XCTUnwrap(ClaudeCodeResponseRewriter(toolNameMap: ["ReadFile": "read_file"], streaming: false))
        XCTAssertEqual(rewriter.process(#"{"content":[{"type":"tool_use","id":"t1","#), "")
        XCTAssertEqual(rewriter.process(#""name":"ReadFile","input":{}}]}"#), "")
        try assertJSON(rewriter.finish(), equals: #"{"content":[{"type":"tool_use","id":"t1","name":"read_file","input":{}}]}"#)
    }

    func testSSEResponseGetsOriginalToolNames() throws {
        let rewriter = try XCTUnwrap(ClaudeCodeResponseRewriter(toolNameMap: ["ReadFile": "read_file"], streaming: true))
        let frame = "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"ReadFile\",\"input\":{}}}\n\n"
        let split = frame.index(frame.startIndex, offsetBy: 40)
        var out = rewriter.process(String(frame[..<split]))
        out += rewriter.process(String(frame[split...]))
        out += rewriter.finish()
        XCTAssertTrue(out.contains("\"name\":\"read_file\""), out)
        XCTAssertFalse(out.contains("ReadFile"), out)
        XCTAssertTrue(out.hasPrefix("event: content_block_start\ndata: "), out)
    }

    func testNoRenamesMeansNoRewriter() {
        XCTAssertNil(ClaudeCodeResponseRewriter(toolNameMap: [:], streaming: true))
    }

    // MARK: - Headers (buildHeaders parity)

    func testSetupTokenHeaders() {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.setValue("context-1m-2025-08-07,tools-2024-04-04", forHTTPHeaderField: "anthropic-beta")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        Credential.applyAuth(to: &request, providerId: "anthropic", authMethod: .oauth, apiKey: "sk-ant-oat01-T")

        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-beta"),
                       "tools-2024-04-04,claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14")
        XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer sk-ant-oat01-T")
        XCTAssertEqual(request.value(forHTTPHeaderField: "user-agent"), "claude-cli/2.1.76")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-app"), "cli")
        XCTAssertEqual(request.value(forHTTPHeaderField: "accept"), "application/json")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-dangerous-direct-browser-access"), "true")
        XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
    }

    func testApiKeyHeaders() {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.setValue("context-1m-2025-08-07", forHTTPHeaderField: "Anthropic-Beta")
        request.setValue("2024-01-01", forHTTPHeaderField: "anthropic-version")
        Credential.applyAuth(to: &request, providerId: "anthropic", authMethod: .apiKey, apiKey: "sk-ant-api03-T")

        XCTAssertNil(request.value(forHTTPHeaderField: "anthropic-beta"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2024-01-01")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "sk-ant-api03-T")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-dangerous-direct-browser-access"), "true")
        XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
    }

    func testTranslatedRequestGetsDefaultVersion() {
        // The translated route drops the app's own anthropic-version.
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        Credential.applyAuth(to: &request, providerId: "anthropic", authMethod: .apiKey, apiKey: "k")
        XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
    }

    // MARK: - Helpers

    private func assertJSON(_ actual: String?, equals expected: String, file: StaticString = #filePath, line: UInt = #line) throws {
        let actualObject = try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(actual, file: file, line: line).utf8))
        let expectedObject = try JSONSerialization.jsonObject(with: Data(expected.utf8))
        XCTAssertEqual(actualObject as? NSDictionary, expectedObject as? NSDictionary, file: file, line: line)
    }
}
