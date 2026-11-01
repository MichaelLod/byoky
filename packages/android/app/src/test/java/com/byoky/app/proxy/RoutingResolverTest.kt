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
            "ollama" to "openai", "azure_openai" to "openai", "mistral" to "openai", "gemini" to "gemini",
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

        // Same-family swap: group binds groq but pins the OpenAI key; the
        // swap is refused and the app's own key is used for its own provider.
        val swap = Group(id = "g", name = "Tampered", providerId = "groq", credentialId = "o1")
        val decision = RoutingResolver.resolve("openai", "gpt-5.5", swap, listOf(openai), families)!!
        assertNull(decision.swapToProviderId)
        assertEquals("o1", decision.credential.id)

        // Direct: group binds openai but pins an Anthropic key.
        val direct = Group(id = "g", name = "Tampered", providerId = "openai", credentialId = "k1")
        assertNull(RoutingResolver.resolve("openai", "gpt-5.5", direct, listOf(key1, openai), families))
        assertNull(RoutingResolver.resolveDirect("openai", direct, listOf(key1, openai)))
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
}
