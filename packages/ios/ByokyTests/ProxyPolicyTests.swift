import XCTest
@testable import Byoky

/// What an approved app may send through the in-wallet browser: endpoints,
/// headers, body encodings, and that a redirect never carries a key away.
/// The endpoint vectors are core's tests/vectors/endpoint-policy.json, which
/// the extension and Android test too.
final class ProxyPolicyTests: XCTestCase {

    // MARK: - Endpoints

    /// packages/core/tests/vectors/endpoint-policy.json, shared with core's
    /// `isAllowedProxyRequest` and Android. A case's "ios" key is this
    /// wallet's exception (Foundation keeps dot segments and encodes
    /// whitespace that WHATWG resolves or strips); its "note" says why.
    func testEndpointAllowlistMatchesTheSharedVectors() throws {
        let cases = try XCTUnwrap(try SharedVectors.load("endpoint-policy")["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 100)
        for c in cases {
            let method = try XCTUnwrap(c["method"] as? String)
            let url = try XCTUnwrap(c["url"] as? String)
            let allowed = try XCTUnwrap((c["ios"] ?? c["allowed"]) as? Bool)
            XCTAssertEqual(ProxyPolicy.isAllowedRequest(method: method, url: url), allowed, "\(method) \(url)")
        }
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
