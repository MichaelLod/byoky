import Foundation

enum AuthMethod: String, Codable {
    case apiKey = "api_key"
    case oauth
}

struct Credential: Identifiable, Codable {
    let id: String
    let providerId: String
    let label: String
    let authMethod: AuthMethod
    let createdAt: Date

    static func create(providerId: String, label: String, authMethod: AuthMethod = .apiKey) -> Credential {
        Credential(
            id: UUID().uuidString,
            providerId: providerId,
            label: label,
            authMethod: authMethod,
            createdAt: Date()
        )
    }
}

struct Provider: Identifiable, Hashable {
    let id: String
    let name: String
    let baseUrl: String
    let icon: String

    static let all: [Provider] = [
        Provider(id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", icon: "brain"),
        Provider(id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com", icon: "sparkles"),
        Provider(id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com", icon: "wand.and.stars"),
        Provider(id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai", icon: "wind"),
        Provider(id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.ai", icon: "text.bubble"),
        Provider(id: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai", icon: "bolt"),
        Provider(id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com", icon: "magnifyingglass"),
        Provider(id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", icon: "questionmark.circle"),
        Provider(id: "groq", name: "Groq", baseUrl: "https://api.groq.com", icon: "bolt.circle"),
        Provider(id: "together", name: "Together AI", baseUrl: "https://api.together.xyz", icon: "person.2"),
        Provider(id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai", icon: "flame"),
        Provider(id: "replicate", name: "Replicate", baseUrl: "https://api.replicate.com", icon: "doc.on.doc"),
        Provider(id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api", icon: "arrow.triangle.branch"),
        Provider(id: "huggingface", name: "Hugging Face", baseUrl: "https://api-inference.huggingface.co", icon: "face.smiling"),
        Provider(id: "azure-openai", name: "Azure OpenAI", baseUrl: "https://openai.azure.com", icon: "cloud"),
    ]

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

    static func validateUrl(_ urlString: String, for providerId: String) -> URL? {
        guard let provider = find(providerId),
              let url = URL(string: urlString),
              let providerUrl = URL(string: provider.baseUrl),
              let urlHost = url.host,
              let providerHost = providerUrl.host,
              urlHost == providerHost,
              url.scheme == "https" else {
            return nil
        }
        return url
    }
}
