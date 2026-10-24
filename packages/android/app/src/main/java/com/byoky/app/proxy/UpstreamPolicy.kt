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
            (url.scheme == "http" && provider.id in setOf("ollama", "lm_studio") && url.host in setOf("localhost", "127.0.0.1"))
    }

    /** May [url] receive the key of a credential of [provider] whose base URL is [credentialBaseUrl]? */
    fun target(provider: Provider, url: HttpUrl, credentialBaseUrl: String?): Target {
        if (!provider.requiresCustomBaseUrl) {
            return if (isRegistryOrigin(provider, url)) Target.Allowed(url.toString()) else Target.WrongHost
        }
        val origin = CredentialBaseUrl.originOf(provider.id, credentialBaseUrl) ?: return Target.MissingBaseUrl
        return if (originOf(url) == origin) Target.Allowed(url.toString()) else Target.WrongHost
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

    private fun originOf(url: HttpUrl): String {
        val defaultPort = HttpUrl.defaultPort(url.scheme)
        return "${url.scheme}://${url.host}" + if (url.port != defaultPort) ":${url.port}" else ""
    }
}
