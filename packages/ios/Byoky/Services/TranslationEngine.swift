import Foundation
import JavaScriptCore

/// Bridges native code to the byoky cross-family translation layer.
///
/// The translation layer lives in @byoky/core and is shipped as a self-contained
/// IIFE bundle (Resources/mobile.js, built by tsup). On first use we evaluate
/// the bundle into a JSContext on a dedicated serial queue and cache references
/// to the global BYOKY_TRANSLATE bridge object. All native callers go through
/// this engine — there is no native port of the translate layer, by design.
/// One source of truth, no Swift/Kotlin/TS divergence to debug.
///
/// Threading: JavaScriptCore JSContext is not thread-safe. We pin all JS work
/// to a single serial DispatchQueue so callers from any actor / queue can hop
/// into the engine safely. The native HTTP client (URLSession) stays on its
/// own queue; the translation step is a microsecond-scale string transform
/// inside the proxy pipeline.
///
/// Stream translators are stateful (they accumulate SSE buffer state across
/// chunks) so we can't expose them as native objects. Instead the JS side
/// holds them in a handle table and we pass integer handles back and forth.
final class TranslationEngine {
    static let shared = TranslationEngine()

    private let queue = DispatchQueue(label: "com.byoky.translation-engine")
    private var context: JSContext?
    private var bridge: JSValue?

    private init() {}

    /// Errors surfaced to native callers. JS exceptions thrown inside the
    /// bundle (e.g. TranslationError for unrepresentable features) are wrapped
    /// in `.translationFailed`. Bundle/load failures are `.bundleLoadFailed`.
    enum EngineError: LocalizedError {
        case bundleNotFound
        case bundleLoadFailed(String)
        case bridgeNotInitialized
        case translationFailed(String)
        case invalidResult

        var errorDescription: String? {
            switch self {
            case .bundleNotFound:
                return "TranslationEngine: mobile.js bundle not found in app resources"
            case .bundleLoadFailed(let msg):
                return "TranslationEngine: failed to evaluate bundle: \(msg)"
            case .bridgeNotInitialized:
                return "TranslationEngine: BYOKY_TRANSLATE global not exposed by bundle"
            case .translationFailed(let msg):
                return "TranslationEngine: \(msg)"
            case .invalidResult:
                return "TranslationEngine: bridge returned an invalid result"
            }
        }
    }

    // MARK: - Initialization

    /// Lazily evaluate the bundle and grab the bridge global. Idempotent and
    /// thread-safe (all work happens on `queue`). Call this from a background
    /// queue at app startup if you want to avoid first-call latency on the
    /// hot path.
    func warmUp() throws {
        try queue.sync {
            try ensureLoadedLocked()
        }
    }

    /// Caller must already hold `queue` (i.e. inside a `queue.sync` block).
    private func ensureLoadedLocked() throws {
        if bridge != nil { return }

        guard let url = Bundle.main.url(forResource: "mobile", withExtension: "js") else {
            throw EngineError.bundleNotFound
        }
        let source: String
        do {
            source = try String(contentsOf: url, encoding: .utf8)
        } catch {
            throw EngineError.bundleLoadFailed(error.localizedDescription)
        }

        guard let ctx = JSContext() else {
            throw EngineError.bundleLoadFailed("could not allocate JSContext")
        }

        var captured: String?
        ctx.exceptionHandler = { _, exception in
            captured = exception?.toString() ?? "unknown JS error"
        }

        ctx.evaluateScript(source)
        if let err = captured {
            throw EngineError.bundleLoadFailed(err)
        }

        guard let global = ctx.objectForKeyedSubscript("BYOKY_TRANSLATE"),
              !global.isUndefined,
              !global.isNull else {
            throw EngineError.bridgeNotInitialized
        }

        self.context = ctx
        self.bridge = global
    }

    // MARK: - Translation API
    //
    // All methods take a `TranslationContext` (encoded as JSON) plus a string
    // body. Returning Swift Strings keeps the bridge contract minimal — no
    // native object marshaling. Errors propagate as Swift `EngineError`.

    /// Translate a request body from src to dst dialect.
    func translateRequest(contextJson: String, body: String) throws -> String {
        try invokeString("translateRequest", args: [contextJson, body])
    }

    /// Translate a non-streaming response body from dst back to src dialect.
    func translateResponse(contextJson: String, body: String) throws -> String {
        try invokeString("translateResponse", args: [contextJson, body])
    }

    /// Open a stateful stream translator. Returns an integer handle that
    /// must be passed to `processStreamChunk` / `flushStreamTranslator` and
    /// eventually released via either `flush` (which releases) or
    /// `releaseStreamTranslator` (which discards without flushing).
    func createStreamTranslator(contextJson: String) throws -> Int {
        try queue.sync {
            try ensureLoadedLocked()
            guard let bridge = self.bridge else { throw EngineError.bridgeNotInitialized }
            guard let result = bridge.invokeMethod("createStreamTranslator", withArguments: [contextJson]),
                  result.isNumber else {
                throw EngineError.invalidResult
            }
            if let err = pendingException() { throw EngineError.translationFailed(err) }
            return Int(result.toInt32())
        }
    }

    /// Process one upstream SSE chunk through a stream handle. Returns the
    /// translated chunk (may be empty if the parser is mid-event).
    func processStreamChunk(handle: Int, chunk: String) throws -> String {
        try invokeString("processStreamChunk", args: [handle, chunk])
    }

    /// Flush any buffered output for a stream handle and release it.
    func flushStreamTranslator(handle: Int) throws -> String {
        try invokeString("flushStreamTranslator", args: [handle])
    }

    /// Release a stream handle without flushing (e.g. on cancellation).
    /// Safe to call on an unknown handle.
    func releaseStreamTranslator(handle: Int) {
        queue.sync {
            try? ensureLoadedLocked()
            bridge?.invokeMethod("releaseStreamTranslator", withArguments: [handle])
        }
    }

    /// Bundle version, for debug surfaces.
    var bundleVersion: String? {
        queue.sync {
            try? ensureLoadedLocked()
            return bridge?.objectForKeyedSubscript("version")?.toString()
        }
    }

    // MARK: - Routing helpers
    //
    // Wrappers around bridge functions used by RoutingResolver. The native side
    // intentionally does not duplicate the family→providers mapping — it lives
    // in core. These thin wrappers are the only place mobile asks "is this
    // pair translatable?" and "what's the destination URL?"

    /// True iff a request from `srcProviderId` should be translated to
    /// `dstProviderId`. False on errors / unknown providers — caller treats
    /// false as "no translation, use direct credential lookup".
    func shouldTranslate(srcProviderId: String, dstProviderId: String) -> Bool {
        do {
            return try queue.sync {
                try ensureLoadedLocked()
                guard let bridge = self.bridge else { return false }
                guard let result = bridge.invokeMethod("shouldTranslate", withArguments: [srcProviderId, dstProviderId]) else {
                    return false
                }
                if pendingException() != nil { return false }
                return result.toBool()
            }
        } catch {
            return false
        }
    }

    /// True iff both providers live in the same known family — i.e. the
    /// routing resolver can perform a *same-family swap* (different provider
    /// id and credential, identical wire format). Distinct from
    /// `shouldTranslate`, which is only true for *cross*-family pairs.
    func sameFamily(srcProviderId: String, dstProviderId: String) -> Bool {
        do {
            return try queue.sync {
                try ensureLoadedLocked()
                guard let bridge = self.bridge else { return false }
                guard let result = bridge.invokeMethod("sameFamily", withArguments: [srcProviderId, dstProviderId]) else {
                    return false
                }
                if pendingException() != nil { return false }
                return result.toBool()
            }
        } catch {
            return false
        }
    }

    /// Build a JSON-encoded TranslationContext for use with translateRequest /
    /// translateResponse / createStreamTranslator. Throws if either provider
    /// is outside a known family — caller is expected to gate on
    /// shouldTranslate first.
    func buildTranslationContext(
        srcProviderId: String,
        dstProviderId: String,
        srcModel: String,
        dstModel: String,
        isStreaming: Bool,
        requestId: String
    ) throws -> String {
        try invokeString(
            "buildTranslationContext",
            args: [srcProviderId, dstProviderId, srcModel, dstModel, isStreaming, requestId]
        )
    }

    /// Return JSON-encoded list of model entries for a provider, or "[]"
    /// if the registry has no entries. Used by the routing editor to suggest
    /// destination models. Caller decodes the JSON.
    func getModelsForProvider(_ providerId: String) -> String {
        do {
            return try invokeString("getModelsForProvider", args: [providerId])
        } catch {
            return "[]"
        }
    }

    /// Return a JSON-encoded summary for a single model id, or nil if the
    /// registry doesn't have it.
    func describeModel(_ modelId: String) -> String? {
        do {
            return try queue.sync {
                try ensureLoadedLocked()
                guard let bridge = self.bridge else { return nil }
                guard let result = bridge.invokeMethod("describeModel", withArguments: [modelId]) else {
                    return nil
                }
                if pendingException() != nil { return nil }
                if result.isNull || result.isUndefined { return nil }
                return result.toString()
            }
        } catch {
            return nil
        }
    }

    /// Inspect a request body and return the capability fingerprint it uses
    /// (tools / vision / structured output / extended reasoning). The native
    /// side calls this from `WalletStore.logRequest` so each entry's
    /// `usedCapabilities` is populated at log time. Returns the empty set on
    /// any error — capability detection is best-effort, never fatal.
    func detectRequestCapabilities(body: Data?) -> CapabilitySet {
        guard let body, let bodyString = String(data: body, encoding: .utf8) else {
            return .empty
        }
        do {
            let json = try invokeString("detectRequestCapabilities", args: [bodyString])
            guard let data = json.data(using: .utf8),
                  let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return .empty
            }
            return CapabilitySet(
                tools: parsed["tools"] as? Bool ?? false,
                vision: parsed["vision"] as? Bool ?? false,
                structuredOutput: parsed["structuredOutput"] as? Bool ?? false,
                reasoning: parsed["reasoning"] as? Bool ?? false,
            )
        } catch {
            return .empty
        }
    }

    /// Apply Claude-Code request-shape compatibility transforms to an
    /// Anthropic OAuth request body. Returns the rewritten body and the
    /// alias→original tool name map (empty if no rewriting was needed).
    ///
    /// The body prefix/system relocation always fires when the credential is
    /// an Anthropic setup token; tool-name rewriting only fires when tools[]
    /// contains non-PascalCase names. The caller must thread `toolNameMap`
    /// through to the response path (SSE rewriter or JSON body rewriter) so
    /// upstream frameworks see their original tool names.
    func prepareClaudeCodeBody(_ body: String) throws -> (body: String, toolNameMap: [String: String]) {
        let json = try invokeString("prepareClaudeCodeBody", args: [body])
        guard let data = json.data(using: .utf8),
              let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EngineError.invalidResult
        }
        let rewrittenBody = parsed["body"] as? String ?? body
        let map = parsed["toolNameMap"] as? [String: String] ?? [:]
        return (rewrittenBody, map)
    }

    /// Open a stateful Claude-Code SSE rewriter. Empty `toolNameMap` → the
    /// rewriter is a no-op passthrough. Returns a handle that must be passed
    /// to `processClaudeCodeSSE` / `flushClaudeCodeSSE` and eventually
    /// released via flush or `releaseClaudeCodeSSE`.
    func createClaudeCodeSSERewriter(toolNameMap: [String: String]) throws -> Int {
        let data = try JSONSerialization.data(withJSONObject: toolNameMap)
        let mapJson = String(data: data, encoding: .utf8) ?? "{}"
        return try queue.sync {
            try ensureLoadedLocked()
            guard let bridge = self.bridge else { throw EngineError.bridgeNotInitialized }
            guard let result = bridge.invokeMethod("createClaudeCodeSSERewriter", withArguments: [mapJson]),
                  result.isNumber else {
                throw EngineError.invalidResult
            }
            if let err = pendingException() { throw EngineError.translationFailed(err) }
            return Int(result.toInt32())
        }
    }

    /// Process one upstream SSE chunk through a Claude Code rewriter handle.
    func processClaudeCodeSSE(handle: Int, chunk: String) throws -> String {
        try invokeString("processClaudeCodeSSE", args: [handle, chunk])
    }

    /// Flush any buffered output for a Claude Code rewriter handle and
    /// release it.
    func flushClaudeCodeSSE(handle: Int) throws -> String {
        try invokeString("flushClaudeCodeSSE", args: [handle])
    }

    /// Release a Claude Code rewriter handle without flushing.
    func releaseClaudeCodeSSE(handle: Int) {
        queue.sync {
            try? ensureLoadedLocked()
            bridge?.invokeMethod("releaseClaudeCodeSSE", withArguments: [handle])
        }
    }

    /// Rewrite `tool_use.name` in a non-streaming Anthropic Messages JSON
    /// response body using the alias→original map. Empty map or unparseable
    /// JSON → body returned unchanged.
    func rewriteClaudeCodeJSONBody(toolNameMap: [String: String], body: String) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: toolNameMap)
        let mapJson = String(data: data, encoding: .utf8) ?? "{}"
        return try invokeString("rewriteClaudeCodeJSONBody", args: [mapJson, body])
    }

    /// Rewrite an upstream URL when routing cross-family. The SDK built the
    /// source URL against the source provider's base + path; we replace it
    /// with the destination provider's canonical chat endpoint, which may
    /// have a different shape (e.g. gemini puts the model in the path).
    /// Returns nil when the destination has no adapter or can't build a URL.
    func rewriteProxyUrl(dstProviderId: String, model: String, stream: Bool) -> String? {
        do {
            return try queue.sync {
                try ensureLoadedLocked()
                guard let bridge = self.bridge else { return nil }
                guard let result = bridge.invokeMethod("rewriteProxyUrl", withArguments: [dstProviderId, model, stream]) else {
                    return nil
                }
                if pendingException() != nil { return nil }
                if result.isNull || result.isUndefined { return nil }
                return result.toString()
            }
        } catch {
            return nil
        }
    }

    // MARK: - Internals

    private func invokeString(_ method: String, args: [Any]) throws -> String {
        try queue.sync {
            try ensureLoadedLocked()
            guard let bridge = self.bridge else { throw EngineError.bridgeNotInitialized }
            guard let result = bridge.invokeMethod(method, withArguments: args) else {
                throw EngineError.invalidResult
            }
            if let err = pendingException() {
                throw EngineError.translationFailed(err)
            }
            if !result.isString {
                throw EngineError.invalidResult
            }
            return result.toString() ?? ""
        }
    }

    /// Pull and clear any pending JS exception captured by the context's
    /// exception handler. Caller holds `queue`.
    private func pendingException() -> String? {
        guard let ctx = context else { return nil }
        if let exception = ctx.exception, !exception.isUndefined {
            ctx.exception = nil
            return exception.toString()
        }
        return nil
    }

    // MARK: - Self-test
    //
    // Phase 1b ships without a wired-up XCTest target (none exists in the
    // project today). This method gives a debug surface to verify the bundle
    // loads and the bridge round-trips correctly. Call from a Settings debug
    // screen or app launch in DEBUG builds. Returns a multi-line report.

    func runSelfTest() -> String {
        var lines: [String] = []
        do {
            try warmUp()
            lines.append("✓ bundle loaded")
            if let v = bundleVersion {
                lines.append("  bundle version: \(v)")
            }

            let ctxJson = """
            {"srcFamily":"anthropic","dstFamily":"openai",\
            "srcProviderId":"anthropic","dstProviderId":"openai",\
            "srcModel":"claude-sonnet-4-5","dstModel":"gpt-4o"}
            """
            let reqBody = """
            {"model":"claude-sonnet-4-5","max_tokens":100,\
            "messages":[{"role":"user","content":"hi"}]}
            """

            let translated = try translateRequest(contextJson: ctxJson, body: reqBody)
            lines.append("✓ translateRequest round-trip")
            lines.append("  output: \(translated.prefix(120))...")

            let handle = try createStreamTranslator(contextJson: ctxJson)
            lines.append("✓ createStreamTranslator → handle \(handle)")
            releaseStreamTranslator(handle: handle)
            lines.append("✓ releaseStreamTranslator")

            lines.append("--- self-test passed ---")
        } catch {
            lines.append("✗ self-test failed: \(error.localizedDescription)")
        }
        return lines.joined(separator: "\n")
    }
}
