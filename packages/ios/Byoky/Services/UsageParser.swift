import Foundation

/// Token usage in provider responses. Mirrors `parseUsage` /
/// `extractUsageFromParsed` in packages/core/src/proxy-utils.ts.
enum UsageParser {
    struct TokenUsage: Equatable {
        let inputTokens: Int
        let outputTokens: Int

        var total: Int { inputTokens + outputTokens }
    }

    /// Bodies larger than this aren't parsed (same limit as core).
    static let maxParseSize = 10_485_760

    static func parseModel(from body: Data?) -> String? {
        guard let body, body.count <= maxParseSize,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let model = json["model"] as? String else {
            return nil
        }
        return model
    }

    /// Usage from a complete response body, streamed (SSE) or plain JSON.
    static func parseUsage(providerId: String, body: String) -> TokenUsage? {
        var meter = UsageMeter(providerId: providerId)
        meter.consume(Data(body.utf8))
        return meter.finish()
    }

    // MARK: - Counting

    /// Usage to log and count once a request is over. Only successful (2xx)
    /// responses count. They count what the response reported; when that's
    /// missing or the response was cut off before its final usage event, and
    /// `shouldEstimate` (see `ProxyPolicy.shouldEstimateUsage`), each missing
    /// side is estimated: input = request bytes / 4, output = response
    /// bytes / 4. So neither an unreadable reply nor cancelling midway makes
    /// a generation free. Same rule as the extension and Android.
    static func settledUsage(
        statusCode: Int,
        meter: UsageMeter,
        shouldEstimate: Bool,
        requestBytes: Int
    ) -> TokenUsage? {
        guard (200..<300).contains(statusCode) else { return nil }
        var input = meter.reportedInput
        var output = meter.reportedOutput
        if shouldEstimate && (input == nil || output == nil || !meter.isComplete) {
            if (input ?? 0) == 0 { input = (requestBytes + 3) / 4 }
            if (output ?? 0) == 0 { output = (meter.byteCount + 3) / 4 }
        }
        guard input != nil || output != nil else { return nil }
        return TokenUsage(inputTokens: input ?? 0, outputTokens: output ?? 0)
    }

    /// What a request may cost, judged from its body alone: the prompt at
    /// four bytes per token, and the output limit it asks for (`max_tokens`
    /// and the other dialects' spellings). Binary and form bodies estimate 0,
    /// as in the extension. Held against the allowance while the request
    /// runs, and charged when it's cancelled before any response.
    static func requestEstimate(for body: ProxyBody?) -> TokenUsage {
        guard let text = body?.asText else { return TokenUsage(inputTokens: 0, outputTokens: 0) }
        let data = Data(text.utf8)
        let input = (data.count + 3) / 4
        guard data.count <= maxParseSize,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return TokenUsage(inputTokens: input, outputTokens: 0)
        }
        let generationConfig = json["generationConfig"] as? [String: Any]
        let limits = [
            json["max_tokens"], json["max_completion_tokens"], json["max_output_tokens"],
            generationConfig?["maxOutputTokens"],
        ].compactMap(count)
        return TokenUsage(inputTokens: input, outputTokens: min(limits.max() ?? 0, 1_000_000))
    }

    // MARK: - Extraction

    /// One server-sent `data:` frame, already parsed.
    fileprivate static func extractUsage(providerId: String, from parsed: [String: Any]) -> TokenUsage? {
        // Anthropic: { usage: { input_tokens, output_tokens } }
        if providerId == "anthropic",
           let usage = parsed["usage"] as? [String: Any],
           let input = anthropicInputTokens(usage),
           let output = count(usage["output_tokens"]) {
            return TokenUsage(inputTokens: input, outputTokens: output)
        }

        // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }.
        // Thinking tokens are billed as output.
        if providerId == "gemini",
           let meta = parsed["usageMetadata"] as? [String: Any],
           let prompt = count(meta["promptTokenCount"]) {
            let output = (count(meta["candidatesTokenCount"]) ?? 0) + (count(meta["thoughtsTokenCount"]) ?? 0)
            return TokenUsage(inputTokens: prompt, outputTokens: output)
        }

        // Cohere v2: { usage: { tokens: { input_tokens, output_tokens } } }
        if providerId == "cohere",
           let tokens = (parsed["usage"] as? [String: Any])?["tokens"] as? [String: Any],
           let input = count(tokens["input_tokens"]),
           let output = count(tokens["output_tokens"]) {
            return TokenUsage(inputTokens: input, outputTokens: output)
        }

        // Groq streaming: { x_groq: { usage: { prompt_tokens, completion_tokens } } }
        if providerId == "groq",
           let usage = (parsed["x_groq"] as? [String: Any])?["usage"] as? [String: Any],
           let prompt = count(usage["prompt_tokens"]),
           let completion = count(usage["completion_tokens"]) {
            return TokenUsage(inputTokens: prompt, outputTokens: completion)
        }

        // OpenAI-compatible: { usage: { prompt_tokens, completion_tokens } }
        let usage = parsed["usage"] as? [String: Any]
        if let usage,
           let prompt = count(usage["prompt_tokens"]),
           let completion = count(usage["completion_tokens"]) {
            return TokenUsage(inputTokens: prompt, outputTokens: completion)
        }
        // Embeddings report prompt tokens only.
        if let usage, let prompt = count(usage["prompt_tokens"]),
           count(usage["completion_tokens"]) == nil, count(usage["input_tokens"]) == nil {
            return TokenUsage(inputTokens: prompt, outputTokens: 0)
        }

        // OpenAI Responses API: `usage` with input/output tokens; in streams
        // the final `response.completed` event carries the whole response.
        let responsesUsage = parsed["type"] as? String == "response.completed"
            ? (parsed["response"] as? [String: Any])?["usage"] as? [String: Any]
            : usage
        if let usage = responsesUsage,
           let input = count(usage["input_tokens"]),
           let output = count(usage["output_tokens"]) {
            return TokenUsage(inputTokens: input, outputTokens: output)
        }

        return nil
    }

    /// Anthropic reports prompt-cache writes and reads apart from
    /// `input_tokens`. They are still prompt tokens the app sent; an
    /// allowance that ignored them could be run down almost for free with
    /// large cached prompts. Nil without `input_tokens`.
    fileprivate static func anthropicInputTokens(_ usage: [String: Any]) -> Int? {
        guard let input = count(usage["input_tokens"]) else { return nil }
        return input + (count(usage["cache_creation_input_tokens"]) ?? 0) + (count(usage["cache_read_input_tokens"]) ?? 0)
    }

    /// A non-negative whole token count from a JSON number.
    fileprivate static func count(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite else { return nil }
        return Int(min(max(double, 0), 1e12).rounded(.down))
    }
}

/// Counts a response's tokens while it streams through, without holding the
/// whole stream: SSE `data:` lines are parsed as they complete; a plain JSON
/// body is kept (up to `UsageParser.maxParseSize`) and parsed at the end.
/// Fed the upstream bytes, before any translation or rewriting.
struct UsageMeter {
    let providerId: String
    /// Response bytes seen so far.
    private(set) var byteCount = 0
    /// The response arrived in full (not cut off or cancelled midway).
    private(set) var isComplete = false
    /// What the response reported, side by side; a stream cut off midway may
    /// carry only its input count. Set by `finish()`.
    private(set) var reportedInput: Int?
    private(set) var reportedOutput: Int?

    private var body = Data()
    private var bodyTooLarge = false
    private var line = Data()
    private var lineTooLong = false
    private var isEventStream = false
    private var lastUsage: UsageParser.TokenUsage?
    // Anthropic streams input tokens on message_start and output tokens on
    // message_delta.
    private var anthropicInput: Int?
    private var anthropicOutput: Int?

    private static let dataPrefix = Data("data: ".utf8)
    private static let doneMarker = Data("[DONE]".utf8)
    private static let maxLineSize = 1_048_576

    init(providerId: String) {
        self.providerId = providerId
    }

    mutating func consume(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        byteCount += chunk.count
        if !bodyTooLarge {
            if body.count + chunk.count <= UsageParser.maxParseSize {
                body.append(chunk)
            } else {
                body = Data()
                bodyTooLarge = true
            }
        }
        var start = chunk.startIndex
        while let newline = chunk[start...].firstIndex(of: 0x0A) {
            appendToLine(chunk[start..<newline])
            endLine()
            start = chunk.index(after: newline)
        }
        appendToLine(chunk[start...])
    }

    /// The upstream body ended normally.
    mutating func markComplete() {
        isComplete = true
    }

    /// The usage the response reported, when it has both sides.
    @discardableResult
    mutating func finish() -> UsageParser.TokenUsage? {
        endLine()
        if isEventStream && providerId == "anthropic" {
            reportedInput = anthropicInput
            reportedOutput = anthropicOutput
        } else {
            var usage = lastUsage
            if !isEventStream, !bodyTooLarge, !body.isEmpty,
               let parsed = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
                usage = UsageParser.extractUsage(providerId: providerId, from: parsed)
            }
            reportedInput = usage?.inputTokens
            reportedOutput = usage?.outputTokens
        }
        guard let input = reportedInput, let output = reportedOutput else { return nil }
        return UsageParser.TokenUsage(inputTokens: input, outputTokens: output)
    }

    private mutating func appendToLine(_ bytes: Data) {
        guard !lineTooLong, !bytes.isEmpty else { return }
        if line.count + bytes.count > Self.maxLineSize {
            // Usage frames are small; a huge line (inline media) is skipped.
            line = Data()
            lineTooLong = true
        } else {
            line.append(bytes)
        }
    }

    private mutating func endLine() {
        defer {
            line = Data()
            lineTooLong = false
        }
        guard !lineTooLong, line.starts(with: Self.dataPrefix) else { return }
        isEventStream = true
        var payload = line.dropFirst(Self.dataPrefix.count)
        if payload.last == 0x0D { payload = payload.dropLast() }
        guard payload.range(of: Self.doneMarker) == nil,
              let parsed = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else { return }

        switch providerId {
        case "anthropic":
            let type = parsed["type"] as? String
            if type == "message_start",
               let usage = (parsed["message"] as? [String: Any])?["usage"] as? [String: Any],
               let input = UsageParser.anthropicInputTokens(usage) {
                anthropicInput = input
            } else if type == "message_delta",
                      let usage = parsed["usage"] as? [String: Any],
                      let output = UsageParser.count(usage["output_tokens"]) {
                anthropicOutput = output
            }
        case "cohere":
            // Usage is on the final `message-end` frame.
            if parsed["type"] as? String == "message-end",
               let tokens = ((parsed["delta"] as? [String: Any])?["usage"] as? [String: Any])?["tokens"] as? [String: Any],
               let input = UsageParser.count(tokens["input_tokens"]),
               let output = UsageParser.count(tokens["output_tokens"]) {
                lastUsage = UsageParser.TokenUsage(inputTokens: input, outputTokens: output)
            }
        default:
            if let usage = UsageParser.extractUsage(providerId: providerId, from: parsed) {
                lastUsage = usage
            }
        }
    }
}
