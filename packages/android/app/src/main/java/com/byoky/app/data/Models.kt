package com.byoky.app.data

import java.util.UUID

enum class AuthMethod { API_KEY, OAUTH }

data class Credential(
    val id: String = UUID.randomUUID().toString(),
    val providerId: String,
    val label: String,
    val authMethod: AuthMethod = AuthMethod.API_KEY,
    val createdAt: Long = System.currentTimeMillis(),
    /**
     * Per-credential upstream origin. Required for providers with no fixed
     * host: Azure OpenAI (tenant-specific subdomain) and local providers
     * (Ollama, LM Studio — user-run loopback servers). Null for providers
     * whose upstream host is fixed globally.
     */
    val baseUrl: String? = null,
)

/** Aggregated request stats for a credential (or provider) over a time window. */
data class CredentialUsageStats(
    val requests: Int,
    val inputTokens: Int,
    val outputTokens: Int,
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
    /**
     * Provider has no fixed upstream host — the real host lives on the
     * credential's `baseUrl`. True for Azure OpenAI (tenant subdomain) and
     * local providers (Ollama, LM Studio — user-run loopback servers).
     */
    val requiresCustomBaseUrl: Boolean = false,
) {
    companion object {
        val all = listOf(
            Provider("anthropic", "Anthropic", "https://api.anthropic.com"),
            Provider("openai", "OpenAI", "https://api.openai.com"),
            Provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com"),
            Provider("mistral", "Mistral", "https://api.mistral.ai"),
            Provider("cohere", "Cohere", "https://api.cohere.com"),
            Provider("xai", "xAI (Grok)", "https://api.x.ai"),
            Provider("deepseek", "DeepSeek", "https://api.deepseek.com"),
            Provider("perplexity", "Perplexity", "https://api.perplexity.ai"),
            Provider("groq", "Groq", "https://api.groq.com"),
            Provider("together", "Together AI", "https://api.together.xyz"),
            Provider("fireworks", "Fireworks AI", "https://api.fireworks.ai"),
            Provider("openrouter", "OpenRouter", "https://openrouter.ai/api"),
            Provider("azure_openai", "Azure OpenAI", "https://openai.azure.com", requiresCustomBaseUrl = true),
            Provider("ollama", "Ollama (local)", "http://localhost:11434", requiresCustomBaseUrl = true),
            Provider("lm_studio", "LM Studio (local)", "http://localhost:1234", requiresCustomBaseUrl = true),
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
    /**
     * Advanced capabilities the source request body used (tools, vision, etc.).
     * Populated by `TranslationEngine.detectRequestCapabilities` at log time so
     * the Apps screen can warn before moving an app to a group whose model
     * lacks one of them. Null on log entries from before this field existed.
     */
    val usedCapabilities: CapabilitySet? = null,
)

/**
 * Capability flags a single request used. Mirrors `CapabilitySet` in
 * `packages/core/src/types.ts`. Walked across an app's recent request log by
 * [detectAppCapabilities] to produce a per-app union, which the Apps screen
 * diffs against a candidate destination model via [capabilityGaps].
 */
data class CapabilitySet(
    val tools: Boolean = false,
    val vision: Boolean = false,
    val structuredOutput: Boolean = false,
    val reasoning: Boolean = false,
) {
    companion object {
        val EMPTY = CapabilitySet()
    }
}

/**
 * OR-merge an app's per-request capability fingerprints into a single union
 * describing everything it has ever needed. Mirrors `detectAppCapabilities`
 * in `packages/core/src/models.ts`.
 */
fun detectAppCapabilities(entries: List<RequestLog>): CapabilitySet {
    var tools = false
    var vision = false
    var structuredOutput = false
    var reasoning = false
    for (e in entries) {
        val used = e.usedCapabilities ?: continue
        if (used.tools) tools = true
        if (used.vision) vision = true
        if (used.structuredOutput) structuredOutput = true
        if (used.reasoning) reasoning = true
    }
    return CapabilitySet(tools, vision, structuredOutput, reasoning)
}

/**
 * Diff a set of capabilities the app has used against a destination model's
 * `capabilities` map (decoded from the JS bridge `describeModel` JSON).
 * Returns the subset of keys the model lacks. Empty list means the model
 * satisfies everything the app has needed so far. Mirrors `capabilityGaps`
 * in `packages/core/src/models.ts`.
 */
fun capabilityGaps(used: CapabilitySet, modelCapabilities: Map<String, Boolean>): List<String> {
    val gaps = mutableListOf<String>()
    if (used.tools && modelCapabilities["tools"] != true) gaps.add("tools")
    if (used.vision && modelCapabilities["vision"] != true) gaps.add("vision")
    if (used.structuredOutput && modelCapabilities["structuredOutput"] != true) gaps.add("structuredOutput")
    if (used.reasoning && modelCapabilities["reasoning"] != true) gaps.add("reasoning")
    return gaps
}

/**
 * Human label for a capability key. Used in warning messages. Mirrors
 * `capabilityLabel` in `packages/core/src/models.ts`.
 */
fun capabilityLabel(key: String): String = when (key) {
    "tools" -> "tool calling"
    "vision" -> "image inputs"
    "structuredOutput" -> "structured outputs"
    "reasoning" -> "extended reasoning"
    else -> key
}

data class TokenAllowance(
    val origin: String,
    val totalLimit: Int? = null,
    val providerLimits: Map<String, Int>? = null,
)

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
 * Mirrors `Group` in `packages/core/src/types.ts`. Each app origin is bound
 * to a group via the `appGroups` map (origin → groupId), set from the Apps
 * screen. The default group catches anything not explicitly bound.
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
        // The default group is a sentinel bucket for apps with no explicit
        // binding. It carries no routing (empty providerId), so unbound apps
        // fall through to direct credential lookup for the provider they
        // actually request. Mirrors the extension's ensureDefaultGroup.
        fun makeDefault() = Group(
            id = DEFAULT_GROUP_ID,
            name = "Default",
            providerId = "",
            credentialId = null,
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
 * Result of running RoutingResolver on a request. Three mutually exclusive
 * shapes, collapsed into one data class for ergonomic call sites:
 *
 *   1. Pass-through:       translation == null && swapToProviderId == null
 *   2. Cross-family:       translation != null
 *   3. Same-family swap:   swapToProviderId != null
 *
 * Same-family swaps skip the JS translation bridge entirely — only URL
 * rewrite, credential swap, and (optionally) body model substitution are
 * needed, because both providers speak identical wire formats.
 */
data class RoutingDecision(
    val credential: Credential,
    val translation: RoutingTranslation? = null,
    /** Destination provider id for a same-family swap; null otherwise. */
    val swapToProviderId: String? = null,
    /**
     * When set, rewrite the outgoing body's `model` field to this value
     * before forwarding. Used by same-family swaps where the group binds a
     * specific destination model that should override the SDK's choice.
     */
    val swapDstModel: String? = null,
    /**
     * Direct-path model override. Set when the group targets the same
     * provider as the request (no translation/swap needed) but pins a
     * specific model. The proxy rewrites the body's `model` field. The
     * group is the strongest routing force — its model wins over the SDK's.
     */
    val modelOverride: String? = null,
) {
    val needsTranslation: Boolean get() = translation != null
    val needsSwap: Boolean get() = swapToProviderId != null
}

// --- Installed apps ---

/**
 * A web app the user added by URL. It opens in the in-wallet browser
 * (AppRuntimeScreen), where the injected bridge lets it call providers
 * through the wallet without ever seeing a key. Persisted unencrypted in
 * `byoky_state` (it holds no secrets).
 */
data class InstalledApp(
    val id: String,
    val name: String,
    /** Normalized https URL the app opens at. */
    val url: String,
    val installedAt: Long = System.currentTimeMillis(),
    val enabled: Boolean = true,
) {
    /** `https://host[:port]`: the identity the bridge, sessions and groups key on. */
    val origin: String get() = AppUrl.originOf(url) ?: url
}

/**
 * Validation and normalization for "Add app by URL". Pure JVM (java.net.URI)
 * so it can be unit-tested without an Android runtime.
 */
object AppUrl {
    sealed class Result {
        data class Valid(val url: String, val origin: String, val suggestedName: String) : Result()
        data class Invalid(val reason: String) : Result()
    }

    /**
     * Accepts `https://…` or a bare host (`app.example.com/path`, which is
     * treated as https). Rejects every other scheme, credentials embedded in
     * the URL, and hosts that don't parse. The fragment is dropped.
     */
    fun normalize(input: String): Result {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return Result.Invalid("Enter a URL")
        if (trimmed.any { it.isWhitespace() }) return Result.Invalid("URLs can't contain spaces")

        val schemeMatch = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*):").find(trimmed)
        val hasAuthority = trimmed.contains("://")
        val candidate = when {
            schemeMatch != null && hasAuthority -> trimmed
            // "localhost:3000" / "example.com:8443/x" look like scheme:rest
            // but are really host:port. Anything else with a scheme and no
            // "//" (mailto:, javascript:, data:) is not a web app URL.
            schemeMatch != null && Regex("^[^/:]+:\\d+(/.*)?$").matches(trimmed) -> "https://$trimmed"
            schemeMatch != null -> return Result.Invalid("Only https:// URLs are supported")
            else -> "https://$trimmed"
        }

        val uri = try { java.net.URI(candidate) } catch (_: Exception) {
            return Result.Invalid("That doesn't look like a valid URL")
        }
        if (!uri.scheme.equals("https", ignoreCase = true)) {
            return Result.Invalid("Only https:// URLs are supported")
        }
        if (uri.rawUserInfo != null) return Result.Invalid("URLs with a username or password aren't allowed")
        val host = uri.host?.lowercase()?.trimEnd('.')
        if (host.isNullOrEmpty()) return Result.Invalid("That doesn't look like a valid URL")
        if (!host.contains('.') && host != "localhost") return Result.Invalid("Enter a full domain, e.g. app.example.com")

        val port = if (uri.port == 443) -1 else uri.port
        val origin = "https://$host" + if (port != -1) ":$port" else ""
        val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
        val query = uri.rawQuery?.let { "?$it" } ?: ""
        return Result.Valid(
            url = origin + path + query,
            origin = origin,
            suggestedName = host.removePrefix("www."),
        )
    }

    private val SHARED_HOSTS = setOf("sites.google.com", "script.google.com")
    private val SHARED_HOST_SUFFIXES = listOf(
        "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev", "workers.dev",
        "web.app", "firebaseapp.com", "appspot.com", "herokuapp.com", "onrender.com",
        "glitch.me", "replit.app", "repl.co", "surge.sh", "fly.dev", "deno.dev", "azurewebsites.net",
    )

    /**
     * True for hosting domains where pages by different authors (or every
     * project of one author) share an origin. Wallet access is granted per
     * origin, so all of them would get it.
     */
    fun isSharedHosting(host: String): Boolean {
        val h = host.lowercase().trimEnd('.')
        return h in SHARED_HOSTS || SHARED_HOST_SUFFIXES.any { h == it || h.endsWith(".$it") }
    }

    /** `https://host[:port]` for a stored app URL, or null if it isn't https. */
    fun originOf(url: String): String? =
        (normalize(url) as? Result.Valid)?.origin
}

/** Compact token count for badges and stats: 950, 12K, 1.3M. */
fun formatTokens(n: Int): String = when {
    n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
    n >= 1_000 -> "${n / 1_000}K"
    else -> "$n"
}
