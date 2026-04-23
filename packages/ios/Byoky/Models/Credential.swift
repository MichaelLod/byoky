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

    /// Apply auth headers and body modifications for this credential's auth method.
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
        if providerId == "anthropic" && authMethod == .oauth {
            // Setup tokens require CLI-like headers and Bearer auth
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            request.setValue("claude-cli/2.1.76", forHTTPHeaderField: "User-Agent")
            request.setValue("cli", forHTTPHeaderField: "x-app")
            if request.value(forHTTPHeaderField: "Accept") == nil {
                request.setValue("application/json", forHTTPHeaderField: "Accept")
            }
            // Merge app's beta flags with OAuth-required flags
            let oauthBeta = ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"]
            let existing = request.value(forHTTPHeaderField: "anthropic-beta")?
                .components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) } ?? []
            let merged = Array(Set(existing + oauthBeta)).sorted()
            request.setValue(merged.joined(separator: ","), forHTTPHeaderField: "anthropic-beta")
            request.setValue("true", forHTTPHeaderField: "anthropic-dangerous-direct-browser-access")
            // Setup tokens require the Claude Code system prompt. If the
            // caller has already run the full Claude-Code request-shape
            // transform via TranslationEngine.prepareClaudeCodeBody (relay
            // path), the system field is already set to the bare prefix —
            // don't append it again.
            if let body = request.httpBody,
               var parsed = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
                let prefix = "You are Claude Code, Anthropic's official CLI for Claude."
                if parsed["system"] == nil {
                    parsed["system"] = prefix
                } else if let existing = parsed["system"] as? String,
                          !existing.hasPrefix(prefix) {
                    parsed["system"] = "\(prefix)\n\n\(existing)"
                }
                request.httpBody = try? JSONSerialization.data(withJSONObject: parsed)
            }
        } else if providerId == "anthropic" {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        } else {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }
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

    static func validateUrl(_ urlString: String, for providerId: String, credentialBaseUrl: String? = nil) -> URL? {
        guard let provider = find(providerId),
              let url = URL(string: urlString),
              let urlHost = url.host else {
            return nil
        }
        let isLocalProvider = providerId == "ollama" || providerId == "lm_studio"
        let isLoopbackHost = urlHost == "localhost" || urlHost == "127.0.0.1" || urlHost == "::1"
        let schemeOk = url.scheme == "https" || (url.scheme == "http" && isLocalProvider && isLoopbackHost)
        guard schemeOk else { return nil }

        // Azure OpenAI uses per-resource subdomains like
        // `mycompany.openai.azure.com`. Strict host equality against the
        // placeholder baseUrl `openai.azure.com` would reject every real
        // Azure URL. Allow any host that ends in `.openai.azure.com`.
        // Mirrors the extension's wildcard `*.openai.azure.com/*` host
        // pattern in wxt.config.ts:40.
        if providerId == "azure_openai" {
            return urlHost.hasSuffix(".openai.azure.com") ? url : nil
        }
        // Local providers: the host must match the credential's stored
        // baseUrl (the user-configured loopback endpoint). Fall through to
        // the generic path if somehow no credential baseUrl is supplied —
        // the loopback scheme check above already limits the surface.
        if isLocalProvider, let credBase = credentialBaseUrl, let credUrl = URL(string: credBase), let credHost = credUrl.host {
            return urlHost == credHost && url.port == credUrl.port ? url : nil
        }
        guard let providerUrl = URL(string: provider.baseUrl),
              let providerHost = providerUrl.host,
              urlHost == providerHost else {
            return nil
        }
        return url
    }
}
