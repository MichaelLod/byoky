package com.byoky.app.data

/**
 * Rules for a credential's own server URL (`Credential.baseUrl`), mirroring
 * `validateProxyUrl` in packages/core/src/proxy-utils.ts:
 *
 *  - Providers with a fixed host (OpenAI, Anthropic, …) never get one; any
 *    value is ignored, so a credential can't redirect traffic elsewhere.
 *  - Providers without a fixed host ([Provider.requiresCustomBaseUrl]: Azure
 *    OpenAI, Ollama, LM Studio) must have one: https, or plain http only to
 *    `localhost` / `127.0.0.1` for the local servers (the only cleartext the
 *    app's network security config allows). No credentials in the URL, no
 *    query or fragment.
 *
 * Pure JVM, unit-tested.
 */
object CredentialBaseUrl {
    private val LOCAL_HTTP_PROVIDERS = setOf("ollama", "lm_studio")
    private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1")

    fun isRequired(providerId: String): Boolean = Provider.find(providerId)?.requiresCustomBaseUrl == true

    /**
     * Normalized `scheme://host[:port][/path]` (no trailing slash) when [input]
     * is acceptable for [providerId], else null. Always null for fixed-host
     * providers.
     */
    fun normalize(providerId: String, input: String?): String? {
        if (!isRequired(providerId)) return null
        val trimmed = input?.trim()?.trimEnd('/') ?: return null
        if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() }) return null
        val uri = try { java.net.URI(trimmed) } catch (_: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
        val allowed = when (scheme) {
            "https" -> true
            "http" -> providerId in LOCAL_HTTP_PROVIDERS && host in LOOPBACK_HOSTS
            else -> false
        }
        if (!allowed) return null
        val defaultPort = if (scheme == "https") 443 else 80
        val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
        val path = uri.rawPath.orEmpty().trimEnd('/')
        return "$scheme://$host$port$path"
    }

    /** `scheme://host[:port]` of an acceptable base URL, for origin checks. */
    fun originOf(providerId: String, baseUrl: String?): String? {
        val normalized = normalize(providerId, baseUrl) ?: return null
        val uri = java.net.URI(normalized)
        val port = if (uri.port == -1) "" else ":${uri.port}"
        return "${uri.scheme}://${uri.host}$port"
    }

    /** User-facing hint for the add-key form. */
    fun requirementText(providerId: String): String =
        if (providerId in LOCAL_HTTP_PROVIDERS) {
            "Use http:// only for a server on this phone (localhost or 127.0.0.1); anything else needs https://."
        } else {
            "Your resource endpoint, e.g. https://my-resource.openai.azure.com (https only)."
        }
}
