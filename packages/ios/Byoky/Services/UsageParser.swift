import Foundation

enum UsageParser {
    struct TokenUsage {
        let inputTokens: Int
        let outputTokens: Int
    }

    static func parseModel(from body: Data?) -> String? {
        guard let body, body.count <= 10_485_760,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let model = json["model"] as? String else {
            return nil
        }
        return model
    }

    static func parseUsage(providerId: String, body: String) -> TokenUsage? {
        // Streaming (SSE) — scan data: lines from the end
        if body.contains("data: ") {
            let lines = body.components(separatedBy: "\n")
                .filter { $0.hasPrefix("data: ") && !$0.contains("[DONE]") }
            for line in lines.reversed() {
                let json = String(line.dropFirst(6))
                guard let data = json.data(using: .utf8),
                      let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let usage = extractUsage(providerId: providerId, from: parsed) else {
                    continue
                }
                return usage
            }
            return nil
        }

        // Non-streaming JSON
        guard let data = body.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return extractUsage(providerId: providerId, from: parsed)
    }

    private static func extractUsage(providerId: String, from parsed: [String: Any]) -> TokenUsage? {
        // Anthropic: { usage: { input_tokens, output_tokens } }
        if providerId == "anthropic",
           let usage = parsed["usage"] as? [String: Any],
           let input = usage["input_tokens"] as? Int,
           let output = usage["output_tokens"] as? Int {
            return sanitize(input: input, output: output)
        }

        // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
        if providerId == "gemini",
           let meta = parsed["usageMetadata"] as? [String: Any],
           let prompt = meta["promptTokenCount"] as? Int {
            let candidates = meta["candidatesTokenCount"] as? Int ?? 0
            return sanitize(input: prompt, output: candidates)
        }

        // OpenAI-compatible: { usage: { prompt_tokens, completion_tokens } }
        if let usage = parsed["usage"] as? [String: Any],
           let prompt = usage["prompt_tokens"] as? Int,
           let completion = usage["completion_tokens"] as? Int {
            return sanitize(input: prompt, output: completion)
        }

        return nil
    }

    private static func sanitize(input: Int, output: Int) -> TokenUsage? {
        let i = max(0, input)
        let o = max(0, output)
        guard i >= 0, o >= 0 else { return nil }
        return TokenUsage(inputTokens: i, outputTokens: o)
    }
}
