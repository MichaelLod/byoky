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
        assertEquals("http://[::1]:1234", CredentialBaseUrl.normalize("lm_studio", "http://[::1]:1234/"))
        assertEquals("http://localhost:1234", CredentialBaseUrl.normalize("lm_studio", "http://localhost:1234"))
    }

    /** IPv6 loopback, as in core and on iOS (R2-04): OkHttp's bare `::1` matches the stored `[::1]`. */
    @Test
    fun ipv6LoopbackServerKeysStayOnTheirServer() {
        val url = "http://[::1]:11434/v1/chat/completions".toHttpUrl()
        assertEquals("::1", url.host)
        assertTrue(UpstreamPolicy.requestUrlAllowed(ollama, url))
        assertEquals(UpstreamPolicy.Target.Allowed(url.toString()), UpstreamPolicy.target(ollama, url, "http://[::1]:11434"))
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(ollama, url, "http://127.0.0.1:11434"))
        assertEquals(UpstreamPolicy.Target.WrongHost, UpstreamPolicy.target(ollama, "http://[::1]:9999/v1/x".toHttpUrl(), "http://[::1]:11434"))
        assertFalse(UpstreamPolicy.requestUrlAllowed(ollama, "http://[::2]:11434/v1/x".toHttpUrl()))
        assertEquals(UpstreamPolicy.Override.Base("http://[::1]:11434"), UpstreamPolicy.rewriteOverride("ollama", "http://[::1]:11434/"))
    }

    /**
     * F020: the SDK's listModels (and a createFetch app) knows only the
     * registry's placeholder host; it goes to the credential's own server.
     */
    @Test
    fun placeholderHostIsRebasedOntoTheCredential() {
        val azurePlaceholder = "https://YOUR_RESOURCE.openai.azure.com/openai/models?api-version=2024-10-21".toHttpUrl()
        assertTrue(UpstreamPolicy.requestUrlAllowed(azure, azurePlaceholder))
        val rebased = UpstreamPolicy.rebase(azure, azurePlaceholder, "https://myres.openai.azure.com/")
        assertEquals("https://myres.openai.azure.com/openai/models?api-version=2024-10-21", rebased.toString())
        assertEquals(UpstreamPolicy.Target.Allowed(rebased.toString()), UpstreamPolicy.target(azure, rebased!!, "https://myres.openai.azure.com/"))
        assertEquals(
            "http://localhost:11500/api/tags",
            UpstreamPolicy.rebase(ollama, "http://localhost:11434/api/tags".toHttpUrl(), "http://localhost:11500").toString(),
        )
        assertEquals(
            "http://127.0.0.1:1234/v1/models",
            UpstreamPolicy.rebase(Provider.find("lm_studio")!!, "http://localhost:1234/v1/models".toHttpUrl(), "http://127.0.0.1:1234").toString(),
        )
        // Only the credential's origin: LM Studio's docs give OpenAI clients
        // http://localhost:1234/v1, and the app's path already carries the /v1.
        val lmStudio = Provider.find("lm_studio")!!
        assertEquals(
            "http://127.0.0.1:1234/v1/chat/completions?x=1",
            UpstreamPolicy.rebase(lmStudio, "http://localhost:1234/v1/chat/completions?x=1".toHttpUrl(), "http://127.0.0.1:1234/v1").toString(),
        )
        assertEquals(
            "http://[::1]:11500/api/tags",
            UpstreamPolicy.rebase(ollama, "http://localhost:11434/api/tags".toHttpUrl(), "http://[::1]:11500/").toString(),
        )
        // A request already on the credential's origin goes out unchanged.
        val onCredential = "http://localhost:1234/v1/chat/completions".toHttpUrl()
        assertNull(UpstreamPolicy.rebase(lmStudio, onCredential, "http://localhost:1234/v1"))
        assertEquals(
            UpstreamPolicy.Target.Allowed("http://localhost:1234/v1/chat/completions"),
            UpstreamPolicy.target(lmStudio, onCredential, "http://localhost:1234/v1"),
        )
        // Another host is checked as it is (and refused by target).
        assertNull(UpstreamPolicy.rebase(azure, "https://evil.openai.azure.com/openai/models".toHttpUrl(), "https://myres.openai.azure.com"))
        assertNull(UpstreamPolicy.rebase(ollama, "http://127.0.0.1:11434/api/tags".toHttpUrl(), "http://localhost:11500"))
        // No usable base URL, or a provider with a fixed host: nothing.
        assertNull(UpstreamPolicy.rebase(azure, azurePlaceholder, null))
        assertNull(UpstreamPolicy.rebase(ollama, "http://localhost:11434/api/tags".toHttpUrl(), "http://192.168.1.20:11434"))
        assertNull(UpstreamPolicy.rebase(openai, "https://api.openai.com/v1/models".toHttpUrl(), "https://evil.example"))
    }

    /** packages/core/tests/vectors/local-server-urls.json, shared with core and iOS. */
    @Test
    fun serverUrlsMatchTheSharedVectors() {
        val cases = SharedVectors.load("local-server-urls.json").getJSONArray("cases")
        assertTrue(cases.length() > 10)
        val failures = mutableListOf<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val providerId = c.getString("providerId")
            val baseUrl = c.getString("baseUrl")
            val allowed = CredentialBaseUrl.normalize(providerId, baseUrl) != null
            if (allowed != c.getBoolean("allowed")) failures += "$providerId $baseUrl: $allowed"
            val request = c.optString("request", "")
            if (request.isNotEmpty()) {
                val provider = Provider.find(providerId)!!
                val url = request.toHttpUrl()
                if (!UpstreamPolicy.requestUrlAllowed(provider, url) ||
                    UpstreamPolicy.target(provider, url, baseUrl) != UpstreamPolicy.Target.Allowed(url.toString())
                ) failures += "$providerId $request refused for $baseUrl"
            }
        }
        assertEquals("disagrees with local-server-urls.json", emptyList<String>(), failures)
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
