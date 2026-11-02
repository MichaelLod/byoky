package com.byoky.app.proxy

import com.byoky.app.data.CredentialBaseUrl
import com.byoky.app.data.Provider
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Where a credential's key may be sent. Every check is made against the one
 * credential routing picked, never against "any credential of this provider":
 * a key must only ever travel to its own provider's host or to the base URL
 * stored on that same credential. Mirrors `validateProxyUrl` in
 * packages/core/src/proxy-utils.ts. Pure, unit-tested.
 */
object UpstreamPolicy {

    sealed interface Target {
        data class Allowed(val url: String) : Target
        /** No-fixed-host provider, but the picked credential has no (valid) base URL. */
        data object MissingBaseUrl : Target
        /** The URL isn't on the provider's host / the credential's server. */
        data object WrongHost : Target
    }

    sealed interface Override {
        /** Fixed-host provider: never pass a base URL to rewriteProxyUrl. */
        data object None : Override
        data class Base(val baseUrl: String) : Override
        data object MissingBaseUrl : Override
    }

    /**
     * First, credential-independent check on the URL an app sent. Fixed-host
     * providers: https to the registry origin. Others: an allowed scheme only;
     * the host is checked against the picked credential in [target].
     */
    fun requestUrlAllowed(provider: Provider, url: HttpUrl): Boolean {
        if (!provider.requiresCustomBaseUrl) return isRegistryOrigin(provider, url)
        return url.scheme == "https" ||
            (url.scheme == "http" && provider.id in setOf("ollama", "lm_studio") && CredentialBaseUrl.isLoopbackHost(url.host))
    }

    /** May [url] receive the key of a credential of [provider] whose base URL is [credentialBaseUrl]? */
    fun target(provider: Provider, url: HttpUrl, credentialBaseUrl: String?): Target {
        if (!provider.requiresCustomBaseUrl) {
            return if (isRegistryOrigin(provider, url)) Target.Allowed(url.toString()) else Target.WrongHost
        }
        val origin = CredentialBaseUrl.originOf(provider.id, credentialBaseUrl) ?: return Target.MissingBaseUrl
        return if (originOf(url) == origin) Target.Allowed(url.toString()) else Target.WrongHost
    }

    /**
     * The host core's provider registry, and so the SDK (`listModels`, a
     * `createFetch` app), names for each provider without a fixed one.
     */
    private val PLACEHOLDER_BASE_URLS = mapOf(
        "azure_openai" to "https://YOUR_RESOURCE.openai.azure.com",
        "ollama" to "http://localhost:11434",
        "lm_studio" to "http://localhost:1234",
    )

    /**
     * [url] on the credential's own origin when it names the placeholder
     * host of a provider without a fixed one (an app knows no other), path
     * and query as they were: the placeholder has no path, so the app's path
     * is already whole, and a credential's own path (LM Studio's
     * `http://localhost:1234/v1`) is not put in front of it again. Null for
     * any other URL (checked by [target] as it is), one already on the
     * credential's origin, or a credential without a usable base URL.
     * Mirrors the extension's `rebaseOntoCredential` and iOS.
     */
    fun rebase(provider: Provider, url: HttpUrl, credentialBaseUrl: String?): HttpUrl? {
        if (!provider.requiresCustomBaseUrl) return null
        val placeholder = PLACEHOLDER_BASE_URLS[provider.id]?.toHttpUrlOrNull() ?: return null
        if (originOf(url) != originOf(placeholder)) return null
        val origin = CredentialBaseUrl.originOf(provider.id, credentialBaseUrl) ?: return null
        if (originOf(url) == origin) return null
        val query = url.encodedQuery?.let { "?$it" } ?: ""
        return "$origin${url.encodedPath}$query".toHttpUrlOrNull()
    }

    /** Base URL to hand to `rewriteProxyUrl` when routing to [dstProviderId]. */
    fun rewriteOverride(dstProviderId: String, credentialBaseUrl: String?): Override {
        if (!CredentialBaseUrl.isRequired(dstProviderId)) return Override.None
        val base = CredentialBaseUrl.normalize(dstProviderId, credentialBaseUrl) ?: return Override.MissingBaseUrl
        return Override.Base(base)
    }

    private fun isRegistryOrigin(provider: Provider, url: HttpUrl): Boolean {
        val base = provider.baseUrl.toHttpUrlOrNull() ?: return false
        return url.scheme == "https" && url.host == base.host && url.port == base.port
    }

    /**
     * `scheme://host[:port]`, written like [CredentialBaseUrl.originOf]:
     * HttpUrl gives an IPv6 host without brackets, java.net.URI with them.
     */
    private fun originOf(url: HttpUrl): String {
        val defaultPort = HttpUrl.defaultPort(url.scheme)
        val host = if (':' in url.host) "[${url.host}]" else url.host
        return "${url.scheme}://$host" + if (url.port != defaultPort) ":${url.port}" else ""
    }
}
