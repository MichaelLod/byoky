import Foundation

/// What an approved app may send through the wallet. Mirrors
/// `isAllowedProxyRequest` and the header allow-list in `buildHeaders`
/// (packages/core/src/proxy-utils.ts); the extension, the bridge and Android
/// apply the same rules.
enum ProxyPolicy {

    // MARK: - Endpoints

    static let endpointNotAllowedCode = "ENDPOINT_NOT_ALLOWED"
    static let endpointNotAllowedMessage = "Apps can only call inference and model-listing endpoints through Byoky"

    /// Path segments that mark provider-side storage or account management
    /// (files, batches, fine-tunes, assistants, org admin, key provisioning).
    /// An approved app may only make inference calls; these would let it read
    /// data other apps stored under the same key, or change the account.
    static let blockedPathSegments: Set<String> = [
        "files", "upload", "uploads", "batches", "batch", "fine_tuning", "fine-tunes", "fine_tunes",
        "assistants", "threads", "vector_stores", "organization", "organizations", "admin", "projects",
        "evals", "containers", "cachedcontents", "realtime", "keys", "api_keys", "invites", "users", "webhooks",
    ]

    /// Gemini's `models/{model}:{action}` inference actions (case-sensitive).
    static let geminiPostActions: Set<String> = [
        "generateContent", "streamGenerateContent", "countTokens", "embedContent", "batchEmbedContents",
    ]

    /// Trailing path segments of the inference endpoints, across provider dialects.
    static let postPathSuffixes: [[String]] = [
        "chat/completions", "completions", "responses", "responses/input_tokens", "embeddings", "moderations",
        "audio/speech", "audio/transcriptions", "audio/translations", "images/generations", "images/edits",
        "images/variations", "messages", "messages/count_tokens", "complete", "chat", "embed", "rerank",
        "generate", "api/show",
    ].map { $0.split(separator: "/").map(String.init) }

    /// Whether an app may make this request through the wallet: GET only for
    /// model listing, POST only to inference endpoints, nothing else (no
    /// DELETE, no files, batches or account management). Only the path is
    /// checked; the origin is `Provider.validateUrl`'s job.
    static func isAllowedRequest(method: String, url: String) -> Bool {
        guard let raw = pathSegments(url) else { return false }
        let segments = raw.map { $0.lowercased() }
        if segments.contains(where: blockedPathSegments.contains) { return false }

        switch method.uppercased() {
        case "GET":
            let n = segments.count
            if n >= 1 && segments[n - 1] == "models" { return true }
            if n >= 2 && segments[n - 2] == "models" && !segments[n - 1].contains(":") { return true }
            return endsWith(segments, ["api", "tags"]) || endsWith(segments, ["api", "version"])
        case "POST":
            if let action = geminiAction(raw), geminiPostActions.contains(action) { return true }
            return postPathSuffixes.contains { endsWith(segments, $0) }
        default:
            return false
        }
    }

    /// The URL's path as percent-decoded segments, empty ones dropped.
    /// Servers decode before routing, so `/v1/%74hreads/t1/messages` must read
    /// as `threads`. Nil (refused) when the URL or an escape doesn't parse
    /// (malformed, or not UTF-8) and when a decoded segment holds a separator
    /// (`%2F`, `%5C`, `%3B` would split differently upstream), as in core.
    /// Also nil in two iOS-only cases no SDK produces: whitespace or control
    /// characters in the URL (WHATWG strips tabs and newlines, Foundation
    /// encodes them), and "." / ".." segments (WHATWG and OkHttp resolve
    /// those before the check; Foundation doesn't, and the server would
    /// resolve them after it).
    private static func pathSegments(_ url: String) -> [String]? {
        guard !url.unicodeScalars.contains(where: {
                  CharacterSet.whitespacesAndNewlines.contains($0) || CharacterSet.controlCharacters.contains($0)
              }),
              // Foundation would quietly re-encode a malformed escape.
              url.range(of: #"%(?![0-9A-Fa-f]{2})"#, options: .regularExpression) == nil,
              let components = URLComponents(string: url),
              components.scheme != nil, components.host != nil else { return nil }
        var decoded: [String] = []
        for segment in components.percentEncodedPath.split(separator: "/") {
            guard let value = segment.removingPercentEncoding,
                  !value.contains(where: { $0 == "/" || $0 == "\\" || $0 == ";" }),
                  value != ".", value != ".." else { return nil }
            decoded.append(value)
        }
        return decoded
    }

    /// The part after the last ":" of the last segment (Gemini's action).
    private static func geminiAction(_ segments: [String]) -> String? {
        guard let last = segments.last, let colon = last.lastIndex(of: ":") else { return nil }
        return String(last[last.index(after: colon)...])
    }

    // MARK: - Usage estimates

    /// Trailing path segments of text-generation endpoints.
    static let generationPathSuffixes: [[String]] = [
        "chat/completions", "completions", "responses", "messages", "chat", "complete", "generate",
    ].map { $0.split(separator: "/").map(String.init) }

    /// Whether a response with no readable usage should be charged an
    /// estimate: only text generation (chat, completions, messages,
    /// responses) is, and only when the reply is JSON or SSE. Embeddings,
    /// images, audio and token counting would be wildly overcharged by a
    /// bytes-based guess, and local servers bill nothing. Mirrors
    /// `shouldEstimateUsage` in core's proxy-utils.ts.
    static func shouldEstimateUsage(upstreamProviderId: String, appUrl: String, contentType: String) -> Bool {
        if Provider.isLocal(upstreamProviderId) { return false }
        let type = contentType.lowercased()
        guard type.contains("json") || type.contains("text/event-stream"),
              let path = URLComponents(string: appUrl)?.percentEncodedPath else { return false }
        let last = path.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        if last.range(of: #":(stream)?[Gg]enerateContent$"#, options: .regularExpression) != nil { return true }
        let segments = path.lowercased().split(separator: "/").map(String.init)
        return generationPathSuffixes.contains { endsWith(segments, $0) }
    }

    private static func endsWith(_ segments: [String], _ suffix: [String]) -> Bool {
        guard suffix.count <= segments.count else { return false }
        return Array(segments.suffix(suffix.count)) == suffix
    }

    // MARK: - Headers

    /// App headers that may go upstream (lowercase names). Everything else is
    /// dropped: hop-by-hop headers, cookies, SDK telemetry and browser fetch
    /// metadata, and the SDK's placeholder auth headers (the real key is
    /// added afterwards by `Credential.applyAuth`).
    static let forwardableHeaders: Set<String> = [
        "content-type",
        "accept",
        // Anthropic
        "anthropic-version",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
        "x-app",
        "user-agent",
        // Cohere
        "x-client-name",
        // OpenAI
        "openai-organization",
        "openai-project",
        "openai-beta",
        // Google
        "x-goog-api-client",
    ]

    /// The app's headers to forward, keyed by lowercase name. Values with CR,
    /// LF or NUL are dropped (header injection). `excluding` removes allowed
    /// names that don't apply to a rerouted request.
    static func forwardedHeaders(_ headers: [String: String], excluding: Set<String> = []) -> [String: String] {
        var result: [String: String] = [:]
        for (name, value) in headers {
            let lower = name.lowercased()
            guard forwardableHeaders.contains(lower), !excluding.contains(lower),
                  !value.unicodeScalars.contains(where: { $0 == "\n" || $0 == "\r" || $0 == "\0" }) else { continue }
            result[lower] = value
        }
        return result
    }
}

// MARK: - Upstream session

/// The URLSession every proxied request goes through. It never follows a
/// redirect: URLSession would replay the key headers (`x-api-key`, `api-key`,
/// `x-goog-api-key`, …) to whatever host the `Location` names. The 3xx comes
/// back to the app as the response instead, like Android
/// (`followRedirects(false)`); the extension and the bridge use
/// `redirect: 'error'`. Ephemeral, so nothing (cache, cookies) is written to
/// disk.
final class ProxyURLSession: NSObject, URLSessionTaskDelegate {
    static let shared = ProxyURLSession()

    private(set) var session: URLSession!

    init(configuration: URLSessionConfiguration = .ephemeral) {
        super.init()
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    /// Streamed response for `request`. Cancelling the calling task cancels
    /// the upstream request.
    func bytes(for request: URLRequest) async throws -> (URLSession.AsyncBytes, URLResponse) {
        try await session.bytes(for: request, delegate: self)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
