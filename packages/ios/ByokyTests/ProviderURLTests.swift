import XCTest
@testable import Byoky

/// Where a key may be sent: request URL validation and credential base URLs.
/// Mirrors resolveProviderBaseUrl / validateProxyUrl in core proxy-utils.ts.
final class ProviderURLTests: XCTestCase {

    func testFixedHostProvidersIgnoreCredentialBaseUrl() {
        XCTAssertNotNil(Provider.validateUrl("https://api.openai.com/v1/chat/completions", for: "openai"))
        XCTAssertNil(Provider.validateUrl("https://evil.example/v1/chat/completions", for: "openai", credentialBaseUrl: "https://evil.example"))
        XCTAssertNil(Provider.validateUrl("http://api.openai.com/v1/chat/completions", for: "openai"))
        XCTAssertNil(Provider.validateUrl("https://api.openai.com:8443/v1/chat/completions", for: "openai"))
        XCTAssertNil(Provider.baseUrlOverride(for: "openai", credentialBaseUrl: "https://evil.example"))
        XCTAssertNil(Provider.customBaseUrl(for: "anthropic", credentialBaseUrl: "https://evil.example"))
    }

    func testLocalProvidersAllowLoopbackHttpOnly() {
        XCTAssertNotNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://localhost:11434"))
        XCTAssertNotNil(Provider.customBaseUrl(for: "lm_studio", credentialBaseUrl: "http://127.0.0.1:1234"))
        // IPv6 loopback too, as in core and on Android (R2-04).
        XCTAssertNotNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://[::1]:11434"))
        XCTAssertNotNil(Provider.validateUrl("http://[::1]:11434/api/chat", for: "ollama", credentialBaseUrl: "http://[::1]:11434"))
        XCTAssertNil(Provider.validateUrl("http://[::1]:9999/api/chat", for: "ollama", credentialBaseUrl: "http://[::1]:11434"))
        XCTAssertNil(Provider.validateUrl("http://127.0.0.1:11434/api/chat", for: "ollama", credentialBaseUrl: "http://[::1]:11434"))
        XCTAssertNotNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "https://ollama.lan:11434"))
        XCTAssertNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://192.168.1.20:11434"))
        XCTAssertNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://user:pw@localhost:11434"))
        XCTAssertNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://localhost:11434/?x=1"))
        XCTAssertNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://localhost:11434/#x"))
        XCTAssertNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "file:///etc/passwd"))

        let base = "http://localhost:11434"
        XCTAssertNotNil(Provider.validateUrl("http://localhost:11434/api/chat", for: "ollama", credentialBaseUrl: base))
        XCTAssertNil(Provider.validateUrl("http://localhost:9999/api/chat", for: "ollama", credentialBaseUrl: base))
        XCTAssertNil(Provider.validateUrl("http://localhost:11434/api/chat", for: "ollama", credentialBaseUrl: nil))
        XCTAssertNil(Provider.validateUrl("https://localhost:11434/api/chat", for: "ollama", credentialBaseUrl: base))
    }

    /// packages/core/tests/vectors/local-server-urls.json, shared with
    /// core's resolveProviderBaseUrl / validateProxyUrl and Android.
    func testServerUrlsMatchTheSharedVectors() throws {
        let cases = try XCTUnwrap(try SharedVectors.load("local-server-urls")["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 10)
        for c in cases {
            let providerId = try XCTUnwrap(c["providerId"] as? String)
            let baseUrl = try XCTUnwrap(c["baseUrl"] as? String)
            let allowed = try XCTUnwrap(c["allowed"] as? Bool)
            XCTAssertEqual(Provider.customBaseUrl(for: providerId, credentialBaseUrl: baseUrl) != nil, allowed, "\(providerId) \(baseUrl)")
            if let request = c["request"] as? String {
                XCTAssertNotNil(Provider.validateUrl(request, for: providerId, credentialBaseUrl: baseUrl), "\(providerId) \(request)")
            }
        }
    }

    func testAzureIsLockedToItsResource() {
        XCTAssertNotNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.openai.azure.com"))
        // Any https endpoint, as in core and on Android: Azure AI Foundry
        // resources live on other hosts.
        XCTAssertNotNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.cognitiveservices.azure.com"))
        XCTAssertNotNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.services.ai.azure.com"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "http://contoso.openai.azure.com"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://u:p@contoso.openai.azure.com"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.openai.azure.com?x=1"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.openai.azure.com#x"))

        let base = "https://contoso.openai.azure.com"
        XCTAssertNotNil(Provider.validateUrl("https://contoso.openai.azure.com/openai/deployments/x/chat/completions", for: "azure_openai", credentialBaseUrl: base))
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/openai/deployments/x", for: "azure_openai", credentialBaseUrl: base))
        // No endpoint (older Azure keys) or an unsafe one: nothing is sent,
        // not even to another *.openai.azure.com resource.
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/openai/deployments/x", for: "azure_openai", credentialBaseUrl: nil))
        XCTAssertNil(Provider.validateUrl("https://evil.example/openai", for: "azure_openai", credentialBaseUrl: nil))
        // The key only ever goes to the credential's own endpoint.
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/x", for: "azure_openai", credentialBaseUrl: "https://contoso.services.ai.azure.com"))
        XCTAssertNotNil(Provider.validateUrl("https://contoso.services.ai.azure.com/openai/v1/chat/completions", for: "azure_openai", credentialBaseUrl: "https://contoso.services.ai.azure.com"))
    }

    /// F020: the SDK's listModels (and a createFetch app) knows only the
    /// registry's placeholder host; it goes to the credential's own endpoint.
    func testPlaceholderHostIsRebasedOntoTheCredential() {
        XCTAssertEqual(
            Provider.rebasedOntoCredential("https://YOUR_RESOURCE.openai.azure.com/openai/models?api-version=2024-10-21",
                                           for: "azure_openai", credentialBaseUrl: "https://myres.openai.azure.com/"),
            "https://myres.openai.azure.com/openai/models?api-version=2024-10-21"
        )
        XCTAssertEqual(
            Provider.rebasedOntoCredential("http://localhost:11434/api/tags", for: "ollama", credentialBaseUrl: "http://localhost:11500"),
            "http://localhost:11500/api/tags"
        )
        XCTAssertEqual(
            Provider.rebasedOntoCredential("http://localhost:1234/v1/models", for: "lm_studio", credentialBaseUrl: "http://127.0.0.1:1234"),
            "http://127.0.0.1:1234/v1/models"
        )
        // Only the credential's origin: LM Studio's docs give OpenAI clients
        // http://localhost:1234/v1, and the app's path already carries the /v1.
        XCTAssertEqual(
            Provider.rebasedOntoCredential("http://localhost:1234/v1/chat/completions?x=1", for: "lm_studio", credentialBaseUrl: "http://127.0.0.1:1234/v1"),
            "http://127.0.0.1:1234/v1/chat/completions?x=1"
        )
        XCTAssertEqual(
            Provider.rebasedOntoCredential("http://localhost:11434/api/tags", for: "ollama", credentialBaseUrl: "http://[::1]:11500/"),
            "http://[::1]:11500/api/tags"
        )
        // A request already on the credential's origin goes out unchanged.
        XCTAssertNil(Provider.rebasedOntoCredential("http://localhost:1234/v1/chat/completions", for: "lm_studio", credentialBaseUrl: "http://localhost:1234/v1"))
        XCTAssertNotNil(Provider.validateUrl("http://localhost:1234/v1/chat/completions", for: "lm_studio", credentialBaseUrl: "http://localhost:1234/v1"))
        // Another host is checked as it is (and refused by validateUrl).
        XCTAssertNil(Provider.rebasedOntoCredential("https://evil.openai.azure.com/openai/models", for: "azure_openai", credentialBaseUrl: "https://myres.openai.azure.com"))
        XCTAssertNil(Provider.rebasedOntoCredential("http://127.0.0.1:11434/api/tags", for: "ollama", credentialBaseUrl: "http://localhost:11500"))
        // No usable endpoint, or a provider with a fixed host: nothing.
        XCTAssertNil(Provider.rebasedOntoCredential("https://YOUR_RESOURCE.openai.azure.com/openai/models", for: "azure_openai", credentialBaseUrl: nil))
        XCTAssertNil(Provider.rebasedOntoCredential("http://localhost:11434/api/tags", for: "ollama", credentialBaseUrl: "http://192.168.1.20:11434"))
        XCTAssertNil(Provider.rebasedOntoCredential("https://api.openai.com/v1/models", for: "openai", credentialBaseUrl: "https://evil.example"))
    }

    func testEndpointEntryUsesImportRules() {
        XCTAssertEqual(Provider.normalizedEndpoint(" https://contoso.openai.azure.com/ ", for: "azure_openai"), "https://contoso.openai.azure.com")
        XCTAssertEqual(Provider.normalizedEndpoint("contoso.openai.azure.com", for: "azure_openai"), "https://contoso.openai.azure.com")
        XCTAssertEqual(Provider.normalizedEndpoint("https://contoso.openai.azure.com/openai", for: "azure_openai"), "https://contoso.openai.azure.com/openai")
        XCTAssertNil(Provider.normalizedEndpoint("", for: "azure_openai"))
        XCTAssertNil(Provider.normalizedEndpoint("http://contoso.openai.azure.com", for: "azure_openai"))
        XCTAssertEqual(Provider.normalizedEndpoint("contoso.cognitiveservices.azure.com", for: "azure_openai"), "https://contoso.cognitiveservices.azure.com")
        XCTAssertNil(Provider.normalizedEndpoint("https://contoso.openai.azure.com?api-version=1", for: "azure_openai"))

        XCTAssertEqual(Provider.normalizedEndpoint("http://localhost:11434/", for: "ollama"), "http://localhost:11434")
        XCTAssertNil(Provider.normalizedEndpoint("http://192.168.1.20:11434", for: "ollama"))
        XCTAssertNil(Provider.normalizedEndpoint("localhost:11434", for: "ollama"))
    }

    /// On a phone, Ollama and LM Studio run on another machine: the form
    /// suggests an https address (no http://localhost prefill) and that
    /// suggestion is one the wallet accepts.
    func testLocalServerSuggestionIsAnAcceptedHttpsAddress() {
        XCTAssertTrue(Provider.localServerPlaceholder.hasPrefix("https://"))
        for provider in ["ollama", "lm_studio"] {
            XCTAssertEqual(Provider.normalizedEndpoint(Provider.localServerPlaceholder, for: provider), Provider.localServerPlaceholder)
            XCTAssertNotNil(Provider.normalizedEndpoint("https://my-mac.tail1234.ts.net:11434", for: provider))
            XCTAssertNil(Provider.normalizedEndpoint("http://mac.local:11434", for: provider))
        }
    }

    func testCredentialsWithoutEndpointAreRefused() {
        XCTAssertEqual(Provider.missingEndpointMessage(providerId: "azure_openai", credentialBaseUrl: nil),
                       "Add your Azure endpoint in the wallet")
        XCTAssertNotNil(Provider.missingEndpointMessage(providerId: "azure_openai", credentialBaseUrl: "http://contoso.openai.azure.com"))
        XCTAssertNil(Provider.missingEndpointMessage(providerId: "azure_openai", credentialBaseUrl: "https://contoso.openai.azure.com"))
        XCTAssertNotNil(Provider.missingEndpointMessage(providerId: "ollama", credentialBaseUrl: nil))
        XCTAssertNil(Provider.missingEndpointMessage(providerId: "openai", credentialBaseUrl: nil))
    }

    /// JavaScriptCore has no WHATWG URL; the engine installs a stand-in the
    /// bundle relies on for base-URL checks.
    func testURLPolyfillParts() throws {
        let parts = try XCTUnwrap(TranslationEngine.urlParts("https://User:pw@Contoso.openai.azure.com:443/a/b?x=1#f"))
        XCTAssertEqual(parts["protocol"], "https:")
        XCTAssertEqual(parts["hostname"], "contoso.openai.azure.com")
        XCTAssertEqual(parts["port"], "")
        XCTAssertEqual(parts["pathname"], "/a/b")
        XCTAssertEqual(parts["search"], "?x=1")
        XCTAssertEqual(parts["hash"], "#f")
        XCTAssertEqual(parts["username"], "User")
        XCTAssertEqual(parts["password"], "pw")
        XCTAssertEqual(parts["origin"], "https://contoso.openai.azure.com")

        let loopback = try XCTUnwrap(TranslationEngine.urlParts("http://[::1]:11434"))
        XCTAssertEqual(loopback["hostname"], "[::1]")
        XCTAssertEqual(loopback["port"], "11434")
        XCTAssertEqual(loopback["pathname"], "/")
        XCTAssertEqual(loopback["origin"], "http://[::1]:11434")

        XCTAssertNil(TranslationEngine.urlParts("not a url"))
        XCTAssertNil(TranslationEngine.urlParts("https://"))
        // Whitespace and control characters are rejected, not trimmed.
        XCTAssertNil(TranslationEngine.urlParts(" https://api.openai.com/v1/chat/completions"))
        XCTAssertNil(TranslationEngine.urlParts("https://api.openai.com/v1/chat/completions\n"))
        XCTAssertNil(TranslationEngine.urlParts("https://api.openai.com/v1/\tchat"))
    }

    /// Translated / swapped requests: every URL the bundled core builds for a
    /// destination passes validation; a fixed-host destination never gets a
    /// credential override.
    func testRewrittenDestinationUrlsValidate() {
        let engine = TranslationEngine.shared
        for provider in ["anthropic", "openai", "gemini", "mistral", "cohere", "xai", "deepseek",
                         "perplexity", "groq", "together", "fireworks", "openrouter"] {
            let override = Provider.baseUrlOverride(for: provider, credentialBaseUrl: "https://evil.example")
            XCTAssertNil(override, provider)
            guard let url = engine.rewriteProxyUrl(dstProviderId: provider, model: "m", stream: true, overrideBaseUrl: override) else {
                XCTFail("no URL for \(provider)")
                continue
            }
            XCTAssertNotNil(Provider.validateUrl(url, for: provider, credentialBaseUrl: "https://evil.example"), "\(provider): \(url)")
        }
        let azureBase = "https://contoso.openai.azure.com"
        let azure = engine.rewriteProxyUrl(
            dstProviderId: "azure_openai", model: "m", stream: false,
            overrideBaseUrl: Provider.baseUrlOverride(for: "azure_openai", credentialBaseUrl: azureBase)
        )
        XCTAssertEqual(azure, "https://contoso.openai.azure.com/openai/v1/chat/completions")
        XCTAssertNotNil(azure.flatMap { Provider.validateUrl($0, for: "azure_openai", credentialBaseUrl: azureBase) })
    }
}
