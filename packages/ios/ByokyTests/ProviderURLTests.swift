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
        XCTAssertNotNil(Provider.customBaseUrl(for: "ollama", credentialBaseUrl: "http://[::1]:11434"))
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

    func testAzureIsLockedToItsResource() {
        XCTAssertNotNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://contoso.openai.azure.com"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "https://evil.example"))
        XCTAssertNil(Provider.customBaseUrl(for: "azure_openai", credentialBaseUrl: "http://contoso.openai.azure.com"))

        let base = "https://contoso.openai.azure.com"
        XCTAssertNotNil(Provider.validateUrl("https://contoso.openai.azure.com/openai/deployments/x/chat/completions", for: "azure_openai", credentialBaseUrl: base))
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/openai/deployments/x", for: "azure_openai", credentialBaseUrl: base))
        // No endpoint (older Azure keys) or an unsafe one: nothing is sent,
        // not even to another *.openai.azure.com resource.
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/openai/deployments/x", for: "azure_openai", credentialBaseUrl: nil))
        XCTAssertNil(Provider.validateUrl("https://evil.example/openai", for: "azure_openai", credentialBaseUrl: nil))
        XCTAssertNil(Provider.validateUrl("https://fabrikam.openai.azure.com/x", for: "azure_openai", credentialBaseUrl: "https://evil.example"))
    }

    func testEndpointEntryUsesImportRules() {
        XCTAssertEqual(Provider.normalizedEndpoint(" https://contoso.openai.azure.com/ ", for: "azure_openai"), "https://contoso.openai.azure.com")
        XCTAssertEqual(Provider.normalizedEndpoint("contoso.openai.azure.com", for: "azure_openai"), "https://contoso.openai.azure.com")
        XCTAssertEqual(Provider.normalizedEndpoint("https://contoso.openai.azure.com/openai", for: "azure_openai"), "https://contoso.openai.azure.com/openai")
        XCTAssertNil(Provider.normalizedEndpoint("", for: "azure_openai"))
        XCTAssertNil(Provider.normalizedEndpoint("http://contoso.openai.azure.com", for: "azure_openai"))
        XCTAssertNil(Provider.normalizedEndpoint("https://evil.example", for: "azure_openai"))
        XCTAssertNil(Provider.normalizedEndpoint("https://contoso.openai.azure.com?api-version=1", for: "azure_openai"))

        XCTAssertEqual(Provider.normalizedEndpoint("http://localhost:11434/", for: "ollama"), "http://localhost:11434")
        XCTAssertNil(Provider.normalizedEndpoint("http://192.168.1.20:11434", for: "ollama"))
        XCTAssertNil(Provider.normalizedEndpoint("localhost:11434", for: "ollama"))
    }

    func testCredentialsWithoutEndpointAreRefused() {
        XCTAssertEqual(Provider.missingEndpointMessage(providerId: "azure_openai", credentialBaseUrl: nil),
                       "Add your Azure endpoint in the wallet")
        XCTAssertNotNil(Provider.missingEndpointMessage(providerId: "azure_openai", credentialBaseUrl: "https://evil.example"))
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
        XCTAssertNotNil(azure.flatMap { Provider.validateUrl($0, for: "azure_openai", credentialBaseUrl: azureBase) })
    }
}
