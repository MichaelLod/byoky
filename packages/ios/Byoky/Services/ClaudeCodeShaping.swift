import Foundation

/// Claude-Code request shaping for Anthropic setup tokens (OAuth), matching
/// the extension's proxy path (background.ts + packages/core/src/proxy-utils.ts).
///
/// Anthropic only accepts setup-token traffic that looks like Claude Code, so
/// before forwarding an Anthropic-shaped body (direct, or after cross-family
/// translation):
///   - non-PascalCase tool names (`read_file`) are renamed to Claude-Code-style
///     aliases (`ReadFile`), and
///   - the Claude Code system line is added. When tools were renamed (a
///     third-party framework), the app's own system prompt moves into the
///     first user message inside `<system_context>`; otherwise the line is
///     just prepended to the existing system prompt.
/// The response then needs the renames undone (`ClaudeCodeResponseRewriter`).
enum ClaudeCodeShaping {
    static let systemPrefix = "You are Claude Code, Anthropic's official CLI for Claude."

    static func applies(providerId: String, authMethod: AuthMethod) -> Bool {
        providerId == "anthropic" && authMethod == .oauth
    }

    /// Shape an Anthropic Messages request body. Returns the body to send and
    /// the alias → original tool-name map for the response (empty when no
    /// tool was renamed).
    static func shape(
        body: String?,
        engine: TranslationEngine = .shared
    ) -> (body: String?, toolNameMap: [String: String]) {
        guard let body, !body.isEmpty else { return (body, [:]) }
        // The bundled core's prepareClaudeCodeBody renames tools and always
        // relocates the system prompt. The extension relocates only for
        // third-party requests (tools renamed), so use its output only then.
        if let prepared = try? engine.prepareClaudeCodeBody(body), !prepared.toolNameMap.isEmpty {
            return (prepared.body, prepared.toolNameMap)
        }
        return (prependSystemPrefix(body), [:])
    }

    /// `injectClaudeCodeSystemPrompt(body, { relocateExisting: false })`:
    /// missing system → the prefix; string → prefix + blank line + original;
    /// text-block array → a prefix block first. Unparseable bodies pass through.
    static func prependSystemPrefix(_ body: String) -> String {
        guard let data = body.data(using: .utf8),
              var parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return body
        }
        let system = parsed["system"]
        if let blocks = system as? [Any] {
            parsed["system"] = [["type": "text", "text": systemPrefix]] + blocks
        } else if let text = system as? String, !text.isEmpty {
            parsed["system"] = "\(systemPrefix)\n\n\(text)"
        } else if system == nil || system is NSNull || system is String {
            parsed["system"] = systemPrefix
        } else {
            return body
        }
        guard let out = try? JSONSerialization.data(withJSONObject: parsed, options: [.withoutEscapingSlashes]) else {
            return body
        }
        return String(decoding: out, as: UTF8.self)
    }
}

/// Undoes Claude-Code tool-name aliases in an Anthropic response so the app
/// sees its own tool names again: per event for SSE, on the whole body for
/// JSON (buffered until `finish()`). Nil when nothing was renamed.
final class ClaudeCodeResponseRewriter {
    private let engine: TranslationEngine
    private let toolNameMap: [String: String]
    private var sseHandle: Int?
    private var jsonBuffer = ""

    init?(toolNameMap: [String: String], streaming: Bool, engine: TranslationEngine = .shared) {
        guard !toolNameMap.isEmpty else { return nil }
        self.engine = engine
        self.toolNameMap = toolNameMap
        if streaming {
            guard let handle = try? engine.createClaudeCodeSSERewriter(toolNameMap: toolNameMap) else { return nil }
            sseHandle = handle
        }
    }

    deinit {
        if let sseHandle { engine.releaseClaudeCodeSSE(handle: sseHandle) }
    }

    /// Rewritten output for one upstream chunk ("" while buffering JSON).
    func process(_ chunk: String) -> String {
        if let sseHandle {
            return (try? engine.processClaudeCodeSSE(handle: sseHandle, chunk: chunk)) ?? chunk
        }
        jsonBuffer += chunk
        return ""
    }

    /// Whatever is left: buffered SSE output, or the rewritten JSON body.
    func finish() -> String {
        if let handle = sseHandle {
            sseHandle = nil
            return (try? engine.flushClaudeCodeSSE(handle: handle)) ?? ""
        }
        let body = jsonBuffer
        jsonBuffer = ""
        guard !body.isEmpty else { return "" }
        return (try? engine.rewriteClaudeCodeJSONBody(toolNameMap: toolNameMap, body: body)) ?? body
    }
}
