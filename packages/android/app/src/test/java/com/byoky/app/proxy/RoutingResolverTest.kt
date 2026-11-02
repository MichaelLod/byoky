package com.byoky.app.proxy

import com.byoky.app.data.Credential
import com.byoky.app.data.Group
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutingResolverTest {

    /**
     * Family table and routing models for the providers used here (core:
     * translate/families.ts and autoRouteModelFor in routing.ts).
     */
    private val families = object : RoutingResolver.Families {
        private val family = mapOf(
            "anthropic" to "anthropic", "openai" to "openai", "groq" to "openai", "deepseek" to "openai",
            "ollama" to "openai", "lm_studio" to "openai", "azure_openai" to "openai", "mistral" to "openai", "gemini" to "gemini",
            "cohere" to "cohere",
        )
        private val autoModels = mapOf("anthropic" to "claude-sonnet-4-6", "openai" to "gpt-5.5", "gemini" to "gemini-2.5-pro")
        override fun shouldTranslate(srcProviderId: String, dstProviderId: String): Boolean {
            val a = family[srcProviderId] ?: return false
            val b = family[dstProviderId] ?: return false
            return a != b
        }
        override fun sameFamily(srcProviderId: String, dstProviderId: String): Boolean =
            srcProviderId != dstProviderId && family[srcProviderId] != null && family[srcProviderId] == family[dstProviderId]
        override fun autoRouteModel(providerId: String): String? = autoModels[providerId]
    }

    private val key1 = Credential(id = "k1", providerId = "anthropic", label = "key #1", createdAt = 2)
    private val key2 = Credential(id = "k2", providerId = "anthropic", label = "key #2", createdAt = 1)
    private val openai = Credential(id = "o1", providerId = "openai", label = "openai", createdAt = 1)

    @Test
    fun aGroupsPinnedKeyIsUsedWhenTheAppCallsTheGroupsOwnProvider() {
        val group = Group(id = "g", name = "Work", providerId = "anthropic", credentialId = "k2", model = "claude-x")
        val decision = RoutingResolver.resolve("anthropic", "claude-y", group, listOf(key1, key2), families)!!
        assertEquals("k2", decision.credential.id)
        assertEquals("claude-x", decision.modelOverride)
    }

    @Test
    fun aStalePinNeverFallsBackToAnotherKey() {
        val group = Group(id = "g", name = "Work", providerId = "anthropic", credentialId = "gone")
        assertNull(RoutingResolver.resolve("anthropic", "claude-y", group, listOf(key1, key2), families))
        assertNull(RoutingResolver.resolveDirect("anthropic", group, listOf(key1, key2)))
    }

    @Test
    fun withoutAPinTheFirstKeyOfTheProviderIsUsed() {
        val decision = RoutingResolver.resolve("anthropic", "m", Group.makeDefault(), listOf(key1, key2), families)!!
        assertEquals("k1", decision.credential.id)
        assertNull(decision.modelOverride)
    }

    @Test
    fun geminiAppsAreTranslatedUsingTheModelFromTheUrl() {
        val url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse".toHttpUrl()
        val body = "{\"contents\":[]}".toByteArray()
        val model = RoutingResolver.requestModel("gemini", url, body)
        assertEquals("gemini-2.5-pro", model)

        val group = Group(id = "g", name = "To OpenAI", providerId = "openai", model = "gpt-5.4")
        val routed = RoutingResolver.resolve("gemini", model, group, listOf(openai), families)!!
        assertEquals("gemini", routed.translation?.srcProviderId)
        assertEquals("gemini-2.5-pro", routed.translation?.srcModel)

        // Auto-routing too: no Gemini key, no group.
        val auto = RoutingResolver.resolve("gemini", model, null, listOf(key1), families)!!
        assertEquals("anthropic", auto.translation?.dstProviderId)
    }

    @Test
    fun geminiStreamingIsReadFromTheUrl() {
        val stream = "https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?alt=sse".toHttpUrl()
        val plain = "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent".toHttpUrl()
        assertTrue(RoutingResolver.isStreamingRequest("gemini", stream, "{}".toByteArray()))
        assertFalse(RoutingResolver.isStreamingRequest("gemini", plain, "{\"stream\":true}".toByteArray()))
        val openaiUrl = "https://api.openai.com/v1/chat/completions".toHttpUrl()
        assertTrue(RoutingResolver.isStreamingRequest("openai", openaiUrl, "{\"stream\":true}".toByteArray()))
        assertFalse(RoutingResolver.isStreamingRequest("openai", openaiUrl, "{}".toByteArray()))
    }

    @Test
    fun theBodyModelWinsAndOtherProvidersDontReadTheUrl() {
        val url = "https://generativelanguage.googleapis.com/v1beta/models/from-url:generateContent".toHttpUrl()
        assertEquals("from-body", RoutingResolver.requestModel("gemini", url, "{\"model\":\"from-body\"}".toByteArray()))
        assertNull(RoutingResolver.requestModel("openai", "https://api.openai.com/v1/models/gpt-4o".toHttpUrl(), null))
    }

    // ── Pins must belong to the group's provider (F010) ──────────────────

    @Test
    fun aPinToAnotherProvidersKeyIsNeverUsed() {
        // Cross-family: group binds anthropic but pins the OpenAI key.
        val cross = Group(id = "g", name = "Tampered", providerId = "anthropic", credentialId = "o1", model = "claude-x")
        assertNull(RoutingResolver.resolve("gemini", "gemini-2.5-pro", cross, listOf(key1, openai), families))

        // Same-family swap: group binds groq but pins the OpenAI key. The
        // swap is refused, and the app's own key doesn't stand in for the
        // group either (F002).
        val swap = Group(id = "g", name = "Tampered", providerId = "groq", credentialId = "o1")
        assertNull(RoutingResolver.resolve("openai", "gpt-5.5", swap, listOf(openai), families))

        // Direct: group binds openai but pins an Anthropic key.
        val direct = Group(id = "g", name = "Tampered", providerId = "openai", credentialId = "k1")
        assertNull(RoutingResolver.resolve("openai", "gpt-5.5", direct, listOf(key1, openai), families))
        assertNull(RoutingResolver.resolveDirect("openai", direct, listOf(key1, openai)))
    }

    // ── A group bound elsewhere never falls back to the app's key (F002) ─

    @Test
    fun aGroupBoundToAnotherProviderNeverFallsBackToTheAppsOwnKey() {
        val deepseek = Credential(id = "d1", providerId = "deepseek", label = "ds", createdAt = 1)
        val ollama = Credential(id = "l1", providerId = "ollama", label = "local", createdAt = 1, baseUrl = "http://localhost:11434")
        val gemini = Credential(id = "gm", providerId = "gemini", label = "gemini", createdAt = 1)
        // No model, and DeepSeek has no routing default.
        val toDeepSeek = Group(id = "g", name = "DeepSeek", providerId = "deepseek")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", toDeepSeek, listOf(key1, deepseek), families))
        // A local-server group without a model.
        val localNoModel = Group(id = "g", name = "Local", providerId = "ollama")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", localNoModel, listOf(key1, ollama), families))
        // A local-server group whose key was deleted, cross-family and same-family.
        val local = Group(id = "g", name = "Local", providerId = "ollama", model = "llama3.3")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", local, listOf(key1), families))
        assertNull(RoutingResolver.resolve("openai", "gpt-5.5", local, listOf(openai), families))
        assertNull(RoutingResolver.canServe("openai", local, listOf(openai), families))
        // A stale pin.
        val stalePin = Group(id = "g", name = "Gemini", providerId = "gemini", credentialId = "removed")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", stalePin, listOf(key1, gemini), families))
        // Without the translation engine, ProxyService uses resolveDirect alone.
        assertNull(RoutingResolver.resolveDirect("openai", local, listOf(openai)))
        assertNull(RoutingResolver.resolveDirect("anthropic", toDeepSeek, listOf(key1)))
        // The default group binds nothing: the app's own key serves it.
        assertEquals("k1", RoutingResolver.resolveDirect("anthropic", Group.makeDefault(), listOf(key1))?.credential?.id)
    }

    // ── Requests that name no model are routed too (F041) ────────────────

    /**
     * A GET or a multipart upload names no model. The group still routes it
     * (ProxyService then refuses it as not a chat request), as core does; it
     * doesn't go out on the key the group routes this app away from.
     */
    @Test
    fun aRequestWithoutAModelIsRoutedByItsGroup() {
        val toClaude = Group(id = "g", name = "Claude", providerId = "anthropic", model = "claude-sonnet-4-6")
        val routed = RoutingResolver.resolve("openai", null, toClaude, listOf(key1, openai), families)!!
        assertEquals("k1", routed.credential.id)
        assertEquals("anthropic", routed.translation?.dstProviderId)
        assertEquals("", routed.translation?.srcModel)
        // Auto-routing doesn't depend on the model either.
        val auto = RoutingResolver.resolve("anthropic", null, null, listOf(openai), families)!!
        assertEquals("o1", auto.credential.id)
        assertEquals("gpt-5.5", auto.translation?.dstModel)
    }

    // ── Model-less cross-family groups (F099) ────────────────────────────

    @Test
    fun aCrossFamilyGroupWithoutAModelUsesTheProvidersRoutingModel() {
        val group = Group(id = "g", name = "To OpenAI", providerId = "openai")
        val decision = RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", group, listOf(key1, openai), families)!!
        assertEquals("o1", decision.credential.id)
        assertEquals("gpt-5.5", decision.translation?.dstModel)
    }

    @Test
    fun aCrossFamilyGroupWithoutAModelOrRoutingDefaultIsNotRouted() {
        val deepseek = Credential(id = "d1", providerId = "deepseek", label = "ds", createdAt = 1)
        val group = Group(id = "g", name = "To DeepSeek", providerId = "deepseek")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", group, listOf(deepseek), families))
    }

    // ── Auto-routing uses core's per-provider model (F015, F100) ─────────

    @Test
    fun autoRoutingTakesTheModelFromCore() {
        val auto = RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", null, listOf(openai), families)!!
        assertEquals("o1", auto.credential.id)
        assertEquals("gpt-5.5", auto.translation?.dstModel)
    }

    @Test
    fun autoRoutingSkipsProvidersWithoutARoutingModel() {
        val deepseek = Credential(id = "d1", providerId = "deepseek", label = "ds", createdAt = 9)
        val ollama = Credential(id = "l1", providerId = "ollama", label = "local", createdAt = 9, baseUrl = "http://localhost:11434")
        assertNull(RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", null, listOf(deepseek, ollama), families))
        val decision = RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", null, listOf(deepseek, ollama, openai), families)!!
        assertEquals("o1", decision.credential.id)
    }

    // ── Local servers route as openai-family destinations (F032) ─────────

    @Test
    fun groupsBoundToALocalServerRoute() {
        val ollama = Credential(id = "l1", providerId = "ollama", label = "local", createdAt = 1, baseUrl = "http://localhost:11434")
        val group = Group(id = "g", name = "Local", providerId = "ollama", model = "llama3.1")
        val swap = RoutingResolver.resolve("openai", "gpt-5.5", group, listOf(ollama, openai), families)!!
        assertEquals("ollama", swap.swapToProviderId)
        assertEquals("llama3.1", swap.swapDstModel)
        val translated = RoutingResolver.resolve("anthropic", "claude-sonnet-4-6", group, listOf(ollama), families)!!
        assertEquals("ollama", translated.translation?.dstProviderId)
        assertEquals("llama3.1", translated.translation?.dstModel)
    }

    /** A request meant for a local server never goes to a cloud key unless a group says so (R2-01). */
    @Test
    fun aRequestForALocalServerIsNeverAutoRoutedToACloudKey() {
        val gemini = Credential(id = "gm", providerId = "gemini", label = "gemini", createdAt = 1)
        val cohere = Credential(id = "co", providerId = "cohere", label = "cohere", createdAt = 1)
        for (local in listOf("ollama", "lm_studio")) {
            assertNull(RoutingResolver.resolve(local, "llama3.1", null, listOf(key1, gemini, cohere), families))
            assertNull(RoutingResolver.resolve(local, "llama3.1", Group.makeDefault(), listOf(key1, gemini, cohere), families))
            assertNull(RoutingResolver.canServe(local, null, listOf(key1, gemini, cohere), families))
        }
        // A group the user set still routes it.
        val toClaude = Group(id = "g", name = "Claude", providerId = "anthropic", model = "claude-sonnet-4-6")
        val routed = RoutingResolver.resolve("ollama", "llama3.1", toClaude, listOf(key1), families)!!
        assertEquals("k1", routed.credential.id)
        assertEquals("anthropic", routed.translation?.dstProviderId)
    }

    // ── Connect availability (F101) ──────────────────────────────────────

    @Test
    fun canServeIsModelAgnosticAndFollowsRouting() {
        // OpenAI key only, no group: an anthropic app is auto-routed.
        assertEquals("o1", RoutingResolver.canServe("anthropic", null, listOf(openai), families)?.id)
        // A group pinned to a key that's gone can't serve its provider.
        val stale = Group(id = "g", name = "Work", providerId = "openai", credentialId = "gone")
        assertNull(RoutingResolver.canServe("openai", stale, listOf(openai), families))
        // Same dialect as the only key, but no group swaps to it: unavailable.
        assertNull(RoutingResolver.canServe("mistral", null, listOf(openai), families))
        // A cross-family app is auto-routed; Cohere has no key, so it's served by OpenAI.
        assertEquals("o1", RoutingResolver.canServe("cohere", null, listOf(openai), families)?.id)
    }

    // R4-03: Gemini takes the model from the URL and ignores a body `model`,
    // so a group's pinned model has to go into the URL.
    @Test
    fun geminiUrlNamesThePinnedModel() {
        val base = "https://generativelanguage.googleapis.com/v1beta/models/"
        assertEquals(
            base + "gemini-3.8-flash:generateContent",
            RoutingResolver.geminiUrl((base + "gemini-2.5-flash:generateContent").toHttpUrl(), "gemini-3.8-flash").toString(),
        )
        assertEquals(
            base + "gemini-3.8-flash:streamGenerateContent?alt=sse",
            RoutingResolver.geminiUrl((base + "gemini-2.5-flash:streamGenerateContent?alt=sse").toHttpUrl(), "gemini-3.8-flash").toString(),
        )
        assertEquals(
            base + "tuned%20model:countTokens",
            RoutingResolver.geminiUrl((base + "gemini-2.5-pro:countTokens").toHttpUrl(), "tuned model").toString(),
        )
        assertNull(RoutingResolver.geminiUrl((base + "text-embedding-004:embedContent").toHttpUrl(), "gemini-3.8-flash"))
        assertNull(RoutingResolver.geminiUrl("https://generativelanguage.googleapis.com/v1beta/models".toHttpUrl(), "gemini-3.8-flash"))
        assertNull(RoutingResolver.geminiUrl((base + ":generateContent").toHttpUrl(), "gemini-3.8-flash"))
        // The OpenAI-compatible endpoint names the model in the body: the pin goes there.
        assertNull(RoutingResolver.geminiUrl("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions".toHttpUrl(), "gemini-3.8-flash"))
    }
}
