import XCTest
@testable import Byoky

/// Token usage for allowances: parsing provider responses (plain and
/// streamed, mirroring core's parseUsage), the fallback estimate, the usage
/// ledger and reservations for requests in flight.
final class UsageMeteringTests: XCTestCase {

    // MARK: - Parsing

    func testPlainJsonUsage() {
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "anthropic", body: #"{"usage":{"input_tokens":12,"output_tokens":34}}"#),
            .init(inputTokens: 12, outputTokens: 34)
        )
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "openai", body: #"{"usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12}}"#),
            .init(inputTokens: 5, outputTokens: 7)
        )
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "gemini", body: #"{"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":20,"thoughtsTokenCount":5}}"#),
            .init(inputTokens: 10, outputTokens: 25)
        )
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "cohere", body: #"{"usage":{"tokens":{"input_tokens":3,"output_tokens":4}}}"#),
            .init(inputTokens: 3, outputTokens: 4)
        )
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "openai", body: #"{"usage":{"input_tokens":8,"output_tokens":9}}"#),
            .init(inputTokens: 8, outputTokens: 9)
        )
        XCTAssertNil(UsageParser.parseUsage(providerId: "openai", body: #"{"id":"x"}"#))
        XCTAssertNil(UsageParser.parseUsage(providerId: "openai", body: "not json"))
        XCTAssertNil(UsageParser.parseUsage(providerId: "openai", body: #"{"usage":{"prompt_tokens":true,"completion_tokens":1}}"#))
    }

    /// Anthropic splits streamed usage: input on message_start, output on
    /// message_delta. Chunks cut through lines and use CRLF.
    func testAnthropicStreamAcrossChunks() {
        let stream = "event: message_start\r\n"
            + #"data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}"# + "\r\n\r\n"
            + "event: content_block_delta\r\n"
            + #"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"data: hi"}}"# + "\r\n\r\n"
            + "event: message_delta\r\n"
            + #"data: {"type":"message_delta","usage":{"output_tokens":15}}"# + "\r\n\r\n"
        var meter = UsageMeter(providerId: "anthropic")
        let bytes = Data(stream.utf8)
        var index = bytes.startIndex
        while index < bytes.endIndex {
            let end = bytes.index(index, offsetBy: 7, limitedBy: bytes.endIndex) ?? bytes.endIndex
            meter.consume(bytes[index..<end])
            index = end
        }
        XCTAssertEqual(meter.byteCount, bytes.count)
        XCTAssertEqual(meter.finish(), .init(inputTokens: 25, outputTokens: 15))
    }

    func testAnthropicStreamWithoutFinalDeltaHasNoUsage() {
        let stream = #"data: {"type":"message_start","message":{"usage":{"input_tokens":25}}}"# + "\n\n"
        XCTAssertNil(UsageParser.parseUsage(providerId: "anthropic", body: stream))
    }

    /// Prompt-cache writes and reads are input tokens too.
    func testAnthropicCacheTokensCountAsInput() {
        XCTAssertEqual(
            UsageParser.parseUsage(providerId: "anthropic", body: #"{"usage":{"input_tokens":10,"cache_creation_input_tokens":200,"cache_read_input_tokens":3000,"output_tokens":5}}"#),
            .init(inputTokens: 3210, outputTokens: 5)
        )
        let stream = #"data: {"type":"message_start","message":{"usage":{"input_tokens":4,"cache_read_input_tokens":1000,"output_tokens":1}}}"# + "\n\n"
            + #"data: {"type":"message_delta","usage":{"output_tokens":7}}"# + "\n\n"
        XCTAssertEqual(UsageParser.parseUsage(providerId: "anthropic", body: stream), .init(inputTokens: 1004, outputTokens: 7))
    }

    func testOpenAIStyleStreamsUseTheLastUsageFrame() {
        let openai = """
        data: {"choices":[{"delta":{"content":"hi"}}],"usage":null}

        data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22}}

        data: [DONE]

        """
        XCTAssertEqual(UsageParser.parseUsage(providerId: "openai", body: openai), .init(inputTokens: 11, outputTokens: 22))

        let gemini = """
        data: {"candidates":[],"usageMetadata":{"promptTokenCount":4}}

        data: {"candidates":[],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":9,"thoughtsTokenCount":1}}

        """
        XCTAssertEqual(UsageParser.parseUsage(providerId: "gemini", body: gemini), .init(inputTokens: 4, outputTokens: 10))

        let groq = """
        data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":2,"completion_tokens":3}}}

        """
        XCTAssertEqual(UsageParser.parseUsage(providerId: "groq", body: groq), .init(inputTokens: 2, outputTokens: 3))

        let cohere = """
        data: {"type":"content-delta","delta":{"message":{"content":{"text":"x"}}}}

        data: {"type":"message-end","delta":{"usage":{"tokens":{"input_tokens":6,"output_tokens":8}}}}

        """
        XCTAssertEqual(UsageParser.parseUsage(providerId: "cohere", body: cohere), .init(inputTokens: 6, outputTokens: 8))

        let responses = """
        event: response.completed
        data: {"type":"response.completed","response":{"usage":{"input_tokens":30,"output_tokens":40}}}

        """
        XCTAssertEqual(UsageParser.parseUsage(providerId: "openai", body: responses), .init(inputTokens: 30, outputTokens: 40))
    }

    func testOversizedLinesAreSkippedNotBuffered() {
        var meter = UsageMeter(providerId: "openai")
        meter.consume(Data("data: {\"x\":\"".utf8))
        meter.consume(Data(repeating: 0x61, count: 2_000_000))
        meter.consume(Data("\"}\n\n".utf8))
        meter.consume(Data(#"data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}"#.utf8))
        XCTAssertEqual(meter.finish(), .init(inputTokens: 1, outputTokens: 2))
    }

    // MARK: - Counting

    private func meter(_ providerId: String, _ body: String, complete: Bool = true) -> UsageMeter {
        var meter = UsageMeter(providerId: providerId)
        meter.consume(Data(body.utf8))
        if complete { meter.markComplete() }
        meter.finish()
        return meter
    }

    private func settled(_ status: Int, _ meter: UsageMeter, estimate: Bool = true, requestBytes: Int = 4000) -> UsageParser.TokenUsage? {
        UsageParser.settledUsage(statusCode: status, meter: meter, shouldEstimate: estimate, requestBytes: requestBytes)
    }

    func testReportedUsageIsCounted() {
        let full = meter("openai", #"{"usage":{"prompt_tokens":10,"completion_tokens":5}}"#)
        XCTAssertEqual(settled(200, full), .init(inputTokens: 10, outputTokens: 5))
        // Requests that aren't estimated still count what was reported.
        XCTAssertEqual(settled(200, full, estimate: false), .init(inputTokens: 10, outputTokens: 5))
        XCTAssertNil(settled(200, meter("anthropic", #"{"input_tokens":1234}"#), estimate: false))
        // Embeddings: prompt tokens only.
        XCTAssertEqual(settled(200, meter("openai", #"{"data":[],"usage":{"prompt_tokens":42,"total_tokens":42}}"#), estimate: false),
                       .init(inputTokens: 42, outputTokens: 0))
    }

    /// No readable usage: request bytes / 4 in, response bytes / 4 out.
    func testUnreadableGenerationIsEstimatedFromBothSides() {
        let unreadable = meter("openai", String(repeating: "x", count: 400))
        XCTAssertEqual(settled(200, unreadable), .init(inputTokens: 1000, outputTokens: 100))
        XCTAssertEqual(settled(200, unreadable, requestBytes: 6), .init(inputTokens: 2, outputTokens: 100))
        XCTAssertNil(settled(200, unreadable, estimate: false))
    }

    /// Only 2xx responses count at all: a refused redirect or an error is free.
    func testOnlySuccessfulResponsesCount() {
        let full = meter("openai", #"{"usage":{"prompt_tokens":10,"completion_tokens":5}}"#)
        let unreadable = meter("openai", String(repeating: "x", count: 400))
        for status in [302, 307, 400, 429, 500] {
            XCTAssertNil(settled(status, full), "\(status)")
            XCTAssertNil(settled(status, unreadable), "\(status)")
        }
    }

    /// A stream cut off after message_start keeps its reported input and
    /// estimates the output from what arrived.
    func testCutOffStreamEstimatesTheMissingSide() {
        let start = #"data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}"# + "\n\n"
        let cut = meter("anthropic", start, complete: false)
        XCTAssertEqual(cut.reportedInput, 25)
        XCTAssertNil(cut.reportedOutput)
        XCTAssertEqual(settled(200, cut), .init(inputTokens: 25, outputTokens: (start.utf8.count + 3) / 4))
        // Cut off after a full usage report: nothing missing, nothing estimated.
        let openai = meter("openai", #"data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}"# + "\n\n", complete: false)
        XCTAssertEqual(settled(200, openai), .init(inputTokens: 3, outputTokens: 4))
        // A JSON reply cut off midway: what arrived is estimated.
        let partial = meter("anthropic", String(repeating: "y", count: 800), complete: false)
        XCTAssertEqual(settled(200, partial, requestBytes: 40), .init(inputTokens: 10, outputTokens: 200))
    }

    /// Held while a request runs, and charged when it's cancelled before any
    /// response: the prompt at 4 bytes per token plus the output limit.
    func testRequestEstimate() {
        XCTAssertEqual(UsageParser.requestEstimate(for: nil), .init(inputTokens: 0, outputTokens: 0))
        let anthropic = #"{"model":"m","max_tokens":1024,"messages":[]}"#
        XCTAssertEqual(UsageParser.requestEstimate(for: .text(anthropic)),
                       .init(inputTokens: (anthropic.utf8.count + 3) / 4, outputTokens: 1024))
        let gemini = #"{"contents":[],"generationConfig":{"maxOutputTokens":256}}"#
        XCTAssertEqual(UsageParser.requestEstimate(for: .text(gemini)).outputTokens, 256)
        XCTAssertEqual(UsageParser.requestEstimate(for: .text("not json")), .init(inputTokens: 2, outputTokens: 0))
        // Binary and form bodies estimate nothing, as in the extension.
        XCTAssertEqual(UsageParser.requestEstimate(for: .binary(Data(repeating: 0xFF, count: 400))).total, 0)
    }

    // MARK: - Ledger and allowance

    func testLedgerKeepsCountingPastTheLogLimit() {
        var ledger = TokenUsageLedger()
        for _ in 0..<1000 { ledger.add(10, origin: "https://a.example", providerId: "openai") }
        ledger.add(5, origin: "https://a.example", providerId: "anthropic")
        ledger.add(0, origin: "https://b.example", providerId: "openai")
        XCTAssertEqual(ledger.total(origin: "https://a.example"), 10_005)
        XCTAssertEqual(ledger.used(origin: "https://a.example", providerId: "openai"), 10_000)
        XCTAssertEqual(ledger.total(origin: "https://b.example"), 0)

        let decoded = try? JSONDecoder().decode(TokenUsageLedger.self, from: JSONEncoder().encode(ledger))
        XCTAssertEqual(decoded, ledger)
    }

    func testLedgerSeedsFromSuccessfulLogEntries() {
        func entry(_ status: Int, _ input: Int?, _ output: Int?) -> RequestLog {
            var log = RequestLog(id: UUID().uuidString, appOrigin: "https://a.example", providerId: "openai",
                                 method: "POST", url: "https://api.openai.com/v1/chat/completions",
                                 statusCode: status, timestamp: Date())
            log.inputTokens = input
            log.outputTokens = output
            return log
        }
        let ledger = TokenUsageLedger.seeded(from: [entry(200, 10, 20), entry(500, 100, 100), entry(200, nil, 5)])
        XCTAssertEqual(ledger.used(origin: "https://a.example", providerId: "openai"), 35)
    }

    func testAllowanceCheck() {
        let allowance = TokenAllowance(origin: "https://a.example", totalLimit: 100, providerLimits: ["openai": 50])
        XCTAssertTrue(AllowanceCheck.compute(allowance: nil, totalUsed: 1_000, providerUsed: 1_000, providerId: "openai").allowed)
        XCTAssertTrue(AllowanceCheck.compute(allowance: allowance, totalUsed: 99, providerUsed: 49, providerId: "openai").allowed)
        XCTAssertFalse(AllowanceCheck.compute(allowance: allowance, totalUsed: 100, providerUsed: 0, providerId: "openai").allowed)
        XCTAssertFalse(AllowanceCheck.compute(allowance: allowance, totalUsed: 60, providerUsed: 50, providerId: "openai").allowed)
        XCTAssertTrue(AllowanceCheck.compute(allowance: allowance, totalUsed: 60, providerUsed: 60, providerId: "anthropic").allowed)
    }

    /// A request that ends after the wallet locked must not save the (now
    /// empty) in-memory log over the stored one.
    @MainActor
    func testRequestsEndingWhileLockedDontWriteTheLog() throws {
        let wallet = WalletStore.shared
        try XCTSkipIf(wallet.isUnlocked, "needs a locked wallet")
        let before = wallet.requestLogs.count
        wallet.logRequest(
            appOrigin: "https://a.example", providerId: "openai", method: "POST",
            url: "https://api.openai.com/v1/chat/completions", statusCode: 200,
            requestBody: nil, usage: .init(inputTokens: 1, outputTokens: 1)
        )
        XCTAssertEqual(wallet.requestLogs.count, before)
    }

    /// Requests in flight hold their estimate, so a burst can't all start on
    /// the same remaining allowance.
    @MainActor
    func testParallelRequestsHoldTheirEstimate() throws {
        let wallet = WalletStore.shared
        let origin = "https://quota-\(UUID().uuidString.prefix(8).lowercased()).example"
        let saved = wallet.tokenAllowances
        defer { wallet.tokenAllowances = saved }
        wallet.tokenAllowances.append(TokenAllowance(origin: origin, totalLimit: 1_000, providerLimits: ["openai": 700]))

        let first = try wallet.reserveTokens(origin: origin, providerId: "openai", estimatedTokens: 600).get()
        let second = try wallet.reserveTokens(origin: origin, providerId: "anthropic", estimatedTokens: 500).get()
        // 1,100 held against a total of 1,000.
        XCTAssertThrowsError(try wallet.reserveTokens(origin: origin, providerId: "gemini", estimatedTokens: 1).get())

        wallet.settleReservation(second, usedTokens: 0)
        let small = try wallet.reserveTokens(origin: origin, providerId: "gemini", estimatedTokens: 1).get()
        let third = try wallet.reserveTokens(origin: origin, providerId: "openai", estimatedTokens: 200).get()
        // openai holds 800 of its 700.
        XCTAssertThrowsError(try wallet.reserveTokens(origin: origin, providerId: "openai", estimatedTokens: 1).get())

        for reservation in [first, small, third] {
            wallet.settleReservation(reservation, usedTokens: 0)
        }
        XCTAssertTrue(wallet.checkAllowance(origin: origin, providerId: "openai").allowed)
    }

    // MARK: - Session usage (session.getUsage)

    private func logEntry(session: String?, provider: String, status: Int, input: Int?, output: Int?) -> RequestLog {
        var entry = RequestLog(
            id: UUID().uuidString, appOrigin: "https://app.example", providerId: provider,
            method: "POST", url: "https://api.example/v1/messages", statusCode: status, timestamp: Date()
        )
        entry.inputTokens = input
        entry.outputTokens = output
        entry.sessionId = session
        return entry
    }

    /// Like the extension's getSessionUsage: only that session's requests
    /// below 400 count, split by the provider the app called.
    func testSessionUsageCountsOnlyThatSessionsSuccessfulRequests() {
        let logs = [
            logEntry(session: "s1", provider: "anthropic", status: 200, input: 10, output: 20),
            logEntry(session: "s1", provider: "anthropic", status: 200, input: 5, output: nil),
            logEntry(session: "s1", provider: "openai", status: 201, input: 1, output: 2),
            logEntry(session: "s1", provider: "openai", status: 429, input: 100, output: 100),
            logEntry(session: "s2", provider: "anthropic", status: 200, input: 7, output: 7),
            logEntry(session: nil, provider: "anthropic", status: 200, input: 9, output: 9),
        ]
        let usage = SessionUsage(sessionId: "s1", logs: logs)
        XCTAssertEqual(usage.total, .init(requests: 3, inputTokens: 16, outputTokens: 22))
        XCTAssertEqual(usage.byProvider, [
            "anthropic": .init(requests: 2, inputTokens: 15, outputTokens: 20),
            "openai": .init(requests: 1, inputTokens: 1, outputTokens: 2),
        ])

        let payload = usage.payload
        XCTAssertEqual(payload["requests"] as? Int, 3)
        XCTAssertEqual(payload["inputTokens"] as? Int, 16)
        XCTAssertEqual(payload["outputTokens"] as? Int, 22)
        let byProvider = payload["byProvider"] as? [String: [String: Int]]
        XCTAssertEqual(byProvider?["anthropic"], ["requests": 2, "inputTokens": 15, "outputTokens": 20])
        XCTAssertNotNil(NativeBridgeHandler.encodeMessage(["payload": payload]))
    }

    func testSessionUsageWithNoRequestsIsZero() {
        let usage = SessionUsage(sessionId: "s1", logs: [])
        XCTAssertEqual(usage.total, .init())
        let payload = usage.payload
        XCTAssertEqual(payload["requests"] as? Int, 0)
        XCTAssertEqual((payload["byProvider"] as? [String: [String: Int]])?.isEmpty, true)
    }

    /// Logs stored before sessions were recorded still decode.
    func testRequestLogWithoutSessionIdDecodes() throws {
        let json = #"{"id":"a","appOrigin":"https://app.example","providerId":"openai","method":"POST","url":"https://api.openai.com/v1/chat/completions","statusCode":200,"timestamp":0}"#
        let entry = try JSONDecoder().decode(RequestLog.self, from: Data(json.utf8))
        XCTAssertNil(entry.sessionId)
    }
}
