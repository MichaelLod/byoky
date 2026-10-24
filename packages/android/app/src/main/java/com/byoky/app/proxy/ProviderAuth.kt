package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod

/**
 * Provider auth headers. Mirrors `buildHeaders` in
 * packages/core/src/proxy-utils.ts (the extension's implementation) for
 * everything that concerns credentials and Anthropic request shape. Pure
 * Kotlin so it can be unit-tested on the JVM.
 *
 * Header names are lower-case, matching what [ProxyService] forwards, so a
 * value set here replaces the app's instead of being sent twice.
 */
object ProviderAuth {
    /** Betas that opt into a paid tier most plans can't bill (core: incompatibleBetas). */
    private val INCOMPATIBLE_ANTHROPIC_BETAS = setOf("context-1m-2025-08-07")

    private val OAUTH_BETAS = listOf(
        "claude-code-20250219",
        "oauth-2025-04-20",
        "fine-grained-tool-streaming-2025-05-14",
        "interleaved-thinking-2025-05-14",
    )

    const val ANTHROPIC_VERSION = "2023-06-01"
    const val CLAUDE_CLI_USER_AGENT = "claude-cli/2.1.76"

    fun apply(headers: MutableMap<String, String>, providerId: String, authMethod: AuthMethod, apiKey: String) {
        when (providerId) {
            "anthropic" -> applyAnthropic(headers, authMethod, apiKey)
            // Azure OpenAI uses `api-key`, not Bearer auth.
            "azure_openai" -> headers["api-key"] = apiKey
            // Header rather than ?key= (query params get sanitized out of logs).
            "gemini" -> headers["x-goog-api-key"] = apiKey
            // Local servers run unauthenticated by default; forward a key only if one was set.
            "ollama", "lm_studio" -> if (apiKey.isNotEmpty()) headers["authorization"] = "Bearer $apiKey"
            else -> headers["authorization"] = "Bearer $apiKey"
        }
    }

    private fun applyAnthropic(headers: MutableMap<String, String>, authMethod: AuthMethod, apiKey: String) {
        // Tools like Hermes auto-attach context-1m-2025-08-07, which moves every
        // request onto long-context billing and 400s on Pro/Max and basic keys.
        val betas = headers["anthropic-beta"].orEmpty()
            .split(",")
            .map { it.trim() }
            .filter { it.isNotEmpty() && it !in INCOMPATIBLE_ANTHROPIC_BETAS }
            .toMutableList()

        if (authMethod == AuthMethod.OAUTH) {
            headers["authorization"] = "Bearer $apiKey"
            headers["user-agent"] = CLAUDE_CLI_USER_AGENT
            headers["x-app"] = "cli"
            headers.putIfAbsent("accept", "application/json")
            betas += OAUTH_BETAS
        } else {
            headers["x-api-key"] = apiKey
        }

        val merged = betas.distinct()
        if (merged.isEmpty()) headers.remove("anthropic-beta") else headers["anthropic-beta"] = merged.joinToString(",")
        headers.putIfAbsent("anthropic-version", ANTHROPIC_VERSION)
        // Anthropic flags browser-origin request signatures and 401s without this.
        headers["anthropic-dangerous-direct-browser-access"] = "true"
    }
}
