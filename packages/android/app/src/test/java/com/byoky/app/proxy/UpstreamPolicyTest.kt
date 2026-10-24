package com.byoky.app.proxy

import com.byoky.app.data.AppUrl
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.CredentialBaseUrl
import com.byoky.app.data.Provider
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A key may only go to its own provider's host or to its own credential's base URL (review item 1). */
class UpstreamPolicyTest {

    private val azure = Provider.find("azure_openai")!!
    private val ollama = Provider.find("ollama")!!
    private val openai = Provider.find("openai")!!

    @Test
    fun azureKeyWithoutBaseUrlIsNeverSentAnywhere() {
        // The attack: another (imported) Azure credential points at evil.example.
        // The picked credential is the user's real one, with no base URL.
        val url = "https://evil.example/openai/deployments/x/chat/completions".toHttpUrl()
        assertTrue(UpstreamPolicy.requestUrlAllowed(azure, url))
        assertEquals(UpstreamPolicy.Target.MissingBaseUrl, UpstreamPolicy.target(azure, url, null))
    }

    @Test
    fun azureKeyOnlyGoesToItsOwnEndpoint() {
        val base = "https://mine.openai.azure.com"
        val ok = "https://mine.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-02-01".toHttpUrl()
        assertEquals(UpstreamPolicy.Target.Allowed(ok.toString()), UpstreamPolicy.target(azure, ok, base))
        // No *.openai.azure.com wildcard: another resource is another host.
        val other = "https://someone-else.openai.azure.com/openai/x".toHttpUrl()
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(azure, other, base))
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(azure, "https://evil.example/x".toHttpUrl(), base))
    }

    @Test
    fun localServerKeysStayOnTheirServer() {
        val url = "http://localhost:11434/v1/chat/completions".toHttpUrl()
        assertTrue(UpstreamPolicy.requestUrlAllowed(ollama, url))
        assertEquals(UpstreamPolicy.Target.Allowed(url.toString()), UpstreamPolicy.target(ollama, url, "http://localhost:11434"))
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(ollama, url, "http://127.0.0.1:11434"))
        assertFalse(UpstreamPolicy.requestUrlAllowed(ollama, "http://192.168.1.5:11434/v1/x".toHttpUrl()))
        // A stored LAN http base URL from an older build is not trusted either.
        assertEquals(UpstreamPolicy.Target.MissingBaseUrl, UpstreamPolicy.target(ollama, "http://192.168.1.5:11434/v1".toHttpUrl(), "http://192.168.1.5:11434"))
    }

    @Test
    fun fixedHostProvidersIgnoreAnyBaseUrl() {
        val real = "https://api.openai.com/v1/chat/completions".toHttpUrl()
        assertEquals(UpstreamPolicy.Target.Allowed(real.toString()), UpstreamPolicy.target(openai, real, "https://evil.example"))
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(openai, "https://evil.example/v1".toHttpUrl(), "https://evil.example"))
        assertFalse(UpstreamPolicy.requestUrlAllowed(openai, "http://api.openai.com/v1".toHttpUrl()))
        assertEquals(UpstreamPolicy.Override.None, UpstreamPolicy.rewriteOverride("openai", "https://evil.example"))
    }

    @Test
    fun rewriteOverrideOnlyForNoFixedHostProviders() {
        assertEquals(UpstreamPolicy.Override.Base("https://mine.openai.azure.com"), UpstreamPolicy.rewriteOverride("azure_openai", "https://mine.openai.azure.com/"))
        assertEquals(UpstreamPolicy.Override.MissingBaseUrl, UpstreamPolicy.rewriteOverride("azure_openai", null))
        assertEquals(UpstreamPolicy.Override.MissingBaseUrl, UpstreamPolicy.rewriteOverride("azure_openai", "http://mine.openai.azure.com"))
        assertEquals(UpstreamPolicy.Override.None, UpstreamPolicy.rewriteOverride("anthropic", "https://evil.example"))
    }

    @Test
    fun credentialBaseUrlRules() {
        assertNull(CredentialBaseUrl.normalize("openai", "https://api.openai.com"))
        assertEquals("https://x.openai.azure.com/sub", CredentialBaseUrl.normalize("azure_openai", " https://X.openai.azure.com:443/sub/ "))
        assertNull(CredentialBaseUrl.normalize("azure_openai", "https://x.openai.azure.com/?q=1"))
        assertNull(CredentialBaseUrl.normalize("lm_studio", "http://[::1]:1234"))
        assertEquals("http://localhost:1234", CredentialBaseUrl.normalize("lm_studio", "http://localhost:1234"))
    }

    @Test
    fun autoRoutingDoesNotTrustFutureCreatedAt() {
        val now = 1_800_000_000_000L
        // Same family (openai), so createdAt decides. A credential created
        // right now must not lose to one claiming to be from next year.
        val current = Credential(id = "current", providerId = "openai", label = "a", authMethod = AuthMethod.API_KEY, createdAt = now)
        val forged = Credential(id = "forged", providerId = "groq", label = "b", authMethod = AuthMethod.API_KEY, createdAt = now + 365L * 24 * 3600 * 1000)
        assertEquals(listOf("current", "forged"), RoutingResolver.autoCandidateOrder(listOf(current, forged), now).map { it.id })
        // Ordinary newest-first still holds for honest timestamps.
        val older = Credential(id = "older", providerId = "openai", label = "c", authMethod = AuthMethod.API_KEY, createdAt = now - 5_000)
        assertEquals(listOf("current", "older"), RoutingResolver.autoCandidateOrder(listOf(older, current), now).map { it.id })
    }

    @Test
    fun sharedHostingOriginsAreRecognised() {
        assertTrue(AppUrl.isSharedHosting("sites.google.com"))
        assertTrue(AppUrl.isSharedHosting("someone.github.io"))
        assertTrue(AppUrl.isSharedHosting("my-app-git-main.vercel.app"))
        assertTrue(AppUrl.isSharedHosting("x.netlify.app"))
        assertTrue(AppUrl.isSharedHosting("x.pages.dev"))
        assertFalse(AppUrl.isSharedHosting("chat.example.com"))
        assertFalse(AppUrl.isSharedHosting("notgithub.io.example.com"))
    }
}
