package com.byoky.app.data

import java.util.UUID

enum class AuthMethod { API_KEY, OAUTH }

data class Credential(
    val id: String = UUID.randomUUID().toString(),
    val providerId: String,
    val label: String,
    val authMethod: AuthMethod = AuthMethod.API_KEY,
    val createdAt: Long = System.currentTimeMillis(),
)

data class Session(
    val id: String = UUID.randomUUID().toString(),
    val appOrigin: String,
    val sessionKey: String,
    val providers: List<String>,
    val createdAt: Long = System.currentTimeMillis(),
    val expiresAt: Long,
) {
    val isExpired: Boolean get() = System.currentTimeMillis() > expiresAt
}

data class Provider(
    val id: String,
    val name: String,
    val baseUrl: String,
    val icon: String,
) {
    companion object {
        val all = listOf(
            Provider("anthropic", "Anthropic", "https://api.anthropic.com", "brain"),
            Provider("openai", "OpenAI", "https://api.openai.com", "sparkles"),
            Provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com", "auto_awesome"),
            Provider("mistral", "Mistral", "https://api.mistral.ai", "air"),
            Provider("cohere", "Cohere", "https://api.cohere.ai", "chat_bubble"),
            Provider("xai", "xAI (Grok)", "https://api.x.ai", "bolt"),
            Provider("deepseek", "DeepSeek", "https://api.deepseek.com", "search"),
            Provider("perplexity", "Perplexity", "https://api.perplexity.ai", "help"),
            Provider("groq", "Groq", "https://api.groq.com", "speed"),
            Provider("together", "Together AI", "https://api.together.xyz", "group"),
            Provider("fireworks", "Fireworks AI", "https://api.fireworks.ai", "local_fire_department"),
            Provider("replicate", "Replicate", "https://api.replicate.com", "content_copy"),
            Provider("openrouter", "OpenRouter", "https://openrouter.ai/api", "route"),
            Provider("huggingface", "Hugging Face", "https://api-inference.huggingface.co", "sentiment_satisfied"),
            Provider("azure-openai", "Azure OpenAI", "https://openai.azure.com", "cloud"),
        )

        fun find(id: String): Provider? = all.firstOrNull { it.id == id }
    }
}

data class RequestLog(
    val id: String = UUID.randomUUID().toString(),
    val appOrigin: String,
    val providerId: String,
    val method: String,
    val url: String,
    val statusCode: Int,
    val timestamp: Long = System.currentTimeMillis(),
    val inputTokens: Int? = null,
    val outputTokens: Int? = null,
    val model: String? = null,
)

enum class BridgeStatus {
    INACTIVE, STARTING, ACTIVE, ERROR;

    var port: Int = 0
    var errorMessage: String? = null
}
