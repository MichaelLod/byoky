package com.byoky.app.proxy

/**
 * Which of an app's request headers reach the provider. An allow-list, the
 * same as core's `FORWARDABLE_HEADERS` (proxy-utils.ts `buildHeaders`) and
 * iOS's `ProxyPolicy.forwardedHeaders`: anything else (cookie, origin and
 * referer, x-stainless-* telemetry, accept-encoding, method overrides,
 * provider-specific project headers, another provider's key header) is
 * dropped. Credentials are added afterwards by [ProviderAuth]. Pure, unit
 * tested.
 */
object HeaderPolicy {

    val FORWARDABLE: Set<String> = setOf(
        "content-type",
        "accept",
        // Anthropic
        "anthropic-version",
        "anthropic-beta",
        "anthropic-dangerous-direct-browser-access",
        "x-app",
        "user-agent",
        // Cohere
        "x-client-name",
        // OpenAI
        "openai-organization",
        "openai-project",
        "openai-beta",
        // Google
        "x-goog-api-client",
    )

    /**
     * The app's allowed headers, keyed by lower-case name (so [ProviderAuth]
     * replaces rather than duplicates them). [excluding] removes allowed
     * names that don't apply to a rerouted request (the source dialect's
     * `anthropic-version`). A value OkHttp would reject (CR, LF, NUL or any
     * other control or non-ASCII character) drops the header instead of
     * failing the request.
     */
    fun forwardedHeaders(headers: Map<String, String>, excluding: Set<String> = emptySet()): MutableMap<String, String> {
        val out = mutableMapOf<String, String>()
        for ((name, value) in headers) {
            val lower = name.lowercase()
            if (lower !in FORWARDABLE || lower in excluding) continue
            if (!value.all { it == '\t' || it in ' '..'~' }) continue
            out[lower] = value
        }
        return out
    }

    /**
     * Upstream response headers an app never gets. Some name the account
     * behind the key (OpenAI's organization and project, Anthropic's
     * organization id), which any connected app could read to link the same
     * user across sites; the rest are server, tracing and cookie headers.
     * SDKs read the request ids and the retry and rate-limit headers, which
     * pass. Same set as core's `STRIPPED_RESPONSE_HEADERS`
     * (tests/vectors/response-headers.json).
     */
    val STRIPPED_RESPONSE_HEADERS: Set<String> = setOf(
        "openai-organization", "openai-project", "anthropic-organization-id",
        "server", "x-cloud-trace-context", "set-cookie", "set-cookie2", "alt-svc", "via",
    )

    /** Excluded from translated and swapped requests: the app's version names its own dialect. */
    val ROUTED_EXCLUDED: Set<String> = setOf("anthropic-version")
}
