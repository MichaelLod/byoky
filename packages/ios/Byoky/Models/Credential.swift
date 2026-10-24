import Foundation

enum AuthMethod: String, Codable {
    case apiKey = "api_key"
    case oauth
}

struct Credential: Identifiable, Codable {
    let id: String
    let providerId: String
    var label: String
    let authMethod: AuthMethod
    let createdAt: Date
    /// Per-credential upstream origin. Required for providers with no fixed
    /// host: Azure OpenAI (tenant-specific subdomain) and local providers
    /// (Ollama, LM Studio — user-run loopback servers). `nil` for providers
    /// whose upstream host is fixed globally.
    var baseUrl: String?

    static func create(providerId: String, label: String, authMethod: AuthMethod = .apiKey, baseUrl: String? = nil) -> Credential {
        Credential(
            id: UUID().uuidString,
            providerId: providerId,
            label: label,
            authMethod: authMethod,
            createdAt: Date(),
            baseUrl: baseUrl
        )
    }

    /// Apply the provider's auth headers for this credential. Setup-token
    /// bodies are shaped separately by `ClaudeCodeShaping`.
    static func applyAuth(to request: inout URLRequest, providerId: String, authMethod: AuthMethod, apiKey: String) {
        // Azure OpenAI uses an `api-key` header, not `Authorization: Bearer`.
        // This matches the extension behavior in proxy-utils.ts:71. Without
        // this special case, mobile sends the wrong header and Azure rejects
        // the request with 401.
        if providerId == "azure_openai" {
            request.setValue(apiKey, forHTTPHeaderField: "api-key")
            return
        }
        // Gemini uses `x-goog-api-key`. Both header and ?key= query param
        // work; the header is safer (query params get sanitized out of logs).
        if providerId == "gemini" {
            request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
            return
        }
        // Local providers (Ollama, LM Studio) run unauthenticated by default.
        // Forward a Bearer key only if the user supplied one.
        if providerId == "ollama" || providerId == "lm_studio" {
            if !apiKey.isEmpty {
                request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            }
            return
        }
        if providerId == "anthropic" {
            applyAnthropicAuth(to: &request, authMethod: authMethod, apiKey: apiKey)
            return
        }
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
    }

    /// Mirrors the anthropic branch of `buildHeaders` in
    /// packages/core/src/proxy-utils.ts. URLRequest header names are
    /// case-insensitive, so values set here replace the app's, never duplicate.
    private static func applyAnthropicAuth(to request: inout URLRequest, authMethod: AuthMethod, apiKey: String) {
        // Betas that opt every request into a tier most plans can't bill
        // (long context) — dropped for API keys and setup tokens alike.
        let incompatibleBetas: Set<String> = ["context-1m-2025-08-07"]
        var betas = (request.value(forHTTPHeaderField: "anthropic-beta") ?? "")
            .components(separatedBy: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !incompatibleBetas.contains($0) }

        if authMethod == .oauth {
            // Setup tokens: Claude-CLI-like headers and Bearer auth. The body
            // is shaped separately (ClaudeCodeShaping).
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("claude-cli/2.1.76", forHTTPHeaderField: "User-Agent")
            request.setValue("cli", forHTTPHeaderField: "x-app")
            if request.value(forHTTPHeaderField: "Accept") == nil {
                request.setValue("application/json", forHTTPHeaderField: "Accept")
            }
            for beta in ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"]
            where !betas.contains(beta) {
                betas.append(beta)
            }
        } else {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        }

        request.setValue(betas.isEmpty ? nil : betas.joined(separator: ","), forHTTPHeaderField: "anthropic-beta")
        // Translated requests drop the app's anthropic-version (it belonged
        // to the source dialect), so always make sure one is present.
        if request.value(forHTTPHeaderField: "anthropic-version") == nil {
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        }
        request.setValue("true", forHTTPHeaderField: "anthropic-dangerous-direct-browser-access")
    }
}

struct Provider: Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let icon: String
    /// Provider has no fixed upstream host — the real host lives on the
    /// credential's `baseUrl`. True for Azure OpenAI (tenant subdomain) and
    /// local providers (Ollama, LM Studio — user-run loopback servers).
    let requiresCustomBaseUrl: Bool

    init(id: String, name: String, baseUrl: String, icon: String, requiresCustomBaseUrl: Bool = false) {
        self.id = id
        self.name = name
        self.baseUrl = baseUrl
        self.icon = icon
        self.requiresCustomBaseUrl = requiresCustomBaseUrl
    }

    static let all: [Provider] = [
        Provider(id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", icon: "provider-anthropic"),
        Provider(id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com", icon: "provider-openai"),
        Provider(id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com", icon: "provider-gemini"),
        Provider(id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai", icon: "provider-mistral"),
        Provider(id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.com", icon: "provider-cohere"),
        Provider(id: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai", icon: "provider-xai"),
        Provider(id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", icon: "provider-deepseek"),
        Provider(id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", icon: "provider-perplexity"),
        Provider(id: "groq", name: "Groq", baseUrl: "https://api.groq.com", icon: "provider-groq"),
        Provider(id: "together", name: "Together AI", baseUrl: "https://api.together.xyz", icon: "provider-together"),
        Provider(id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai", icon: "provider-fireworks"),
        Provider(id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api", icon: "provider-openrouter"),
        Provider(id: "azure_openai", name: "Azure OpenAI", baseUrl: "https://openai.azure.com", icon: "provider-azure_openai", requiresCustomBaseUrl: true),
        Provider(id: "ollama", name: "Ollama (local)", baseUrl: "http://localhost:11434", icon: "provider-ollama", requiresCustomBaseUrl: true),
        Provider(id: "lm_studio", name: "LM Studio (local)", baseUrl: "http://localhost:1234", icon: "provider-lm_studio", requiresCustomBaseUrl: true),
    ]

    /// Provider IDs that were removed from the registry. Used by WalletStore on
    /// unlock to prune any stored credentials that reference dead providers, so
    /// the credential list can't decode entries for providers that no longer exist.
    static let removedProviderIds: Set<String> = ["replicate", "huggingface", "azure-openai"]

    static func find(_ id: String) -> Provider? {
        all.first { $0.id == id }
    }

    static func buildUrl(provider: Provider, path: String) -> URL? {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        guard !normalizedPath.hasPrefix("//") else { return nil }
        guard let url = URL(string: provider.baseUrl + normalizedPath),
              let baseUrl = URL(string: provider.baseUrl),
              url.host == baseUrl.host,
              url.scheme == "https" else {
            return nil
        }
        return url
    }

    // MARK: - Upstream URL rules (mirror packages/core/src/proxy-utils.ts)

    static func isLocal(_ providerId: String) -> Bool {
        providerId == "ollama" || providerId == "lm_studio"
    }

    static func isLoopbackHost(_ host: String) -> Bool {
        ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host.lowercased())
    }

    /// https always; plain http only to a loopback host for local providers.
    static func isAllowedScheme(_ url: URL, for providerId: String) -> Bool {
        switch url.scheme?.lowercased() {
        case "https": return true
        case "http": return isLocal(providerId) && isLoopbackHost(url.host ?? "")
        default: return false
        }
    }

    /// A credential's own base URL, if the provider uses one and it is safe:
    /// only providers without a fixed host (Azure, Ollama, LM Studio) use it;
    /// it must pass `isAllowedScheme`, carry no user:password, query or
    /// fragment, and for Azure point at an `*.openai.azure.com` resource.
    /// Mirrors core's `resolveProviderBaseUrl`, plus the Azure host rule this
    /// app has always enforced for Azure requests.
    static func customBaseUrl(for providerId: String, credentialBaseUrl: String?) -> URL? {
        guard let provider = find(providerId), provider.requiresCustomBaseUrl,
              let raw = credentialBaseUrl, !raw.isEmpty,
              let components = URLComponents(string: raw),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              let url = components.url,
              isAllowedScheme(url, for: providerId) else {
            return nil
        }
        if providerId == "azure_openai" && !host.lowercased().hasSuffix(".openai.azure.com") {
            return nil
        }
        return url
    }

    /// The base-URL override to hand to `rewriteProxyUrl`: the credential's
    /// own base URL for custom-host providers, never anything for fixed-host
    /// ones (so a tampered credential can't redirect a fixed provider).
    static func baseUrlOverride(for providerId: String, credentialBaseUrl: String?) -> String? {
        customBaseUrl(for: providerId, credentialBaseUrl: credentialBaseUrl) != nil ? credentialBaseUrl : nil
    }

    /// Normalize and validate an endpoint / server URL the user typed for a
    /// custom-host provider, with the same rules as import. Trailing slashes
    /// are dropped; an Azure endpoint typed without a scheme gets https://.
    static func normalizedEndpoint(_ input: String, for providerId: String) -> String? {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") { value.removeLast() }
        guard !value.isEmpty else { return nil }
        if providerId == "azure_openai" && !value.contains("://") { value = "https://" + value }
        return customBaseUrl(for: providerId, credentialBaseUrl: value) != nil ? value : nil
    }

    /// Why a custom-host credential can't be used yet (no safe endpoint), or
    /// nil when it can. Keys are never sent anywhere but their own endpoint.
    static func missingEndpointMessage(providerId: String, credentialBaseUrl: String?) -> String? {
        guard find(providerId)?.requiresCustomBaseUrl == true,
              customBaseUrl(for: providerId, credentialBaseUrl: credentialBaseUrl) == nil else { return nil }
        return providerId == "azure_openai"
            ? "Add your Azure endpoint in the wallet"
            : "Add your server URL in the wallet"
    }

    /// Same scheme, host and port (default ports filled in).
    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        func port(_ url: URL) -> Int? {
            if let port = url.port { return port }
            switch url.scheme?.lowercased() {
            case "https": return 443
            case "http": return 80
            default: return nil
            }
        }
        return a.scheme?.lowercased() == b.scheme?.lowercased()
            && a.host?.lowercased() == b.host?.lowercased()
            && port(a) == port(b)
    }

    /// Check that a request URL targets the provider's upstream before any
    /// key is attached. Fixed-host providers must hit their registered origin
    /// (a credential base URL is ignored); custom-host providers must hit
    /// the origin of the credential's (safe) base URL.
    static func validateUrl(_ urlString: String, for providerId: String, credentialBaseUrl: String? = nil) -> URL? {
        guard let provider = find(providerId),
              let url = URL(string: urlString),
              let host = url.host, !host.isEmpty,
              isAllowedScheme(url, for: providerId) else {
            return nil
        }

        if provider.requiresCustomBaseUrl {
            // Only ever the credential's own endpoint; none means no request.
            guard let base = customBaseUrl(for: providerId, credentialBaseUrl: credentialBaseUrl) else { return nil }
            return sameOrigin(url, base) ? url : nil
        }

        guard let base = URL(string: provider.baseUrl) else { return nil }
        return sameOrigin(url, base) ? url : nil
    }
}
