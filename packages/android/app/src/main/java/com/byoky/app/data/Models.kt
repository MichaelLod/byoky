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
            Provider("cohere", "Cohere", "https://api.cohere.com", "chat_bubble"),
            Provider("xai", "xAI (Grok)", "https://api.x.ai", "bolt"),
            Provider("deepseek", "DeepSeek", "https://api.deepseek.com", "search"),
            Provider("perplexity", "Perplexity", "https://api.perplexity.ai", "help"),
            Provider("groq", "Groq", "https://api.groq.com", "speed"),
            Provider("together", "Together AI", "https://api.together.xyz", "group"),
            Provider("fireworks", "Fireworks AI", "https://api.fireworks.ai", "local_fire_department"),
            Provider("openrouter", "OpenRouter", "https://openrouter.ai/api", "route"),
            Provider("azure_openai", "Azure OpenAI", "https://openai.azure.com", "cloud"),
        )

        /**
         * Provider IDs that were removed from the registry. Used by WalletStore on
         * unlock to prune any stored credentials that reference dead providers.
         */
        val removedProviderIds = setOf("replicate", "huggingface", "azure-openai")

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
    /** Provider we actually called upstream when cross-family routing kicked in. */
    val actualProviderId: String? = null,
    /** Model we actually called upstream when routing changed it. */
    val actualModel: String? = null,
    /** Group that routed this request. Mobile uses the default group globally. */
    val groupId: String? = null,
)

data class TokenAllowance(
    val origin: String,
    val totalLimit: Int? = null,
    val providerLimits: Map<String, Int>? = null,
)

object AllowanceCheck {
    data class Result(val allowed: Boolean, val reason: String? = null)

    fun compute(allowance: TokenAllowance?, entries: List<RequestLog>, providerId: String): Result {
        if (allowance == null) return Result(allowed = true)

        var totalUsed = 0
        val byProvider = mutableMapOf<String, Int>()
        for (entry in entries) {
            val tokens = (entry.inputTokens ?: 0) + (entry.outputTokens ?: 0)
            totalUsed += tokens
            byProvider[entry.providerId] = (byProvider[entry.providerId] ?: 0) + tokens
        }

        if (allowance.totalLimit != null && totalUsed >= allowance.totalLimit) {
            return Result(allowed = false, reason = "Token allowance exceeded for ${allowance.origin}")
        }

        val providerLimit = allowance.providerLimits?.get(providerId)
        if (providerLimit != null && (byProvider[providerId] ?: 0) >= providerLimit) {
            return Result(allowed = false, reason = "Token allowance for $providerId exceeded")
        }

        return Result(allowed = true)
    }
}

enum class BridgeStatus {
    INACTIVE, STARTING, ACTIVE, ERROR;

    var port: Int = 0
    var errorMessage: String? = null
}

/**
 * Stable id for the always-present default group. Mirrors `DEFAULT_GROUP_ID`
 * in `packages/core/src/types.ts`. Apps with no explicit binding land here.
 */
const val DEFAULT_GROUP_ID = "default"

/**
 * A logical bucket that an app's requests are routed through. Binding the
 * group to (provider, credential, model) lets us reroute every app in the
 * group transparently — and, when the destination is in a different family
 * than what the app called, drives cross-family translation.
 *
 * Mirrors `Group` in `packages/core/src/types.ts`. Mobile groups today are
 * global routing rules (the proxy doesn't track per-app origin), so the
 * default group is the only one consulted in the proxy path. Multi-group
 * support is wired through CRUD for forward compat.
 */
data class Group(
    val id: String,
    val name: String,
    val providerId: String,
    val credentialId: String? = null,
    val model: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    companion object {
        fun makeDefault(providerId: String = "anthropic", credentialId: String? = null) = Group(
            id = DEFAULT_GROUP_ID,
            name = "Default",
            providerId = providerId,
            credentialId = credentialId,
            model = null,
        )
    }
}

/**
 * Cross-family routing context attached to a request when the resolver
 * decided this request needs translation. Threaded through the proxy path
 * so the JS bridge knows what to translate to and from. Mirrors
 * `SessionTranslation` in `packages/core/src/types.ts`.
 */
data class RoutingTranslation(
    val srcProviderId: String,
    val dstProviderId: String,
    val srcModel: String,
    val dstModel: String,
)

/**
 * Result of running RoutingResolver on a request. `translation == null` means
 * pass-through (no translation needed); a non-null value means rewrite the
 * upstream URL, swap credentials, and call the JS bridge.
 */
data class RoutingDecision(
    val credential: Credential,
    val translation: RoutingTranslation?,
) {
    val needsTranslation: Boolean get() = translation != null
}
