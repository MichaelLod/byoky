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

    /** Family table for the providers used here (core: translate/families.ts). */
    private val families = object : RoutingResolver.Families {
        private val family = mapOf("anthropic" to "anthropic", "openai" to "openai", "groq" to "openai", "gemini" to "gemini")
        override fun shouldTranslate(srcProviderId: String, dstProviderId: String): Boolean {
            val a = family[srcProviderId] ?: return false
            val b = family[dstProviderId] ?: return false
            return a != b
        }
        override fun sameFamily(srcProviderId: String, dstProviderId: String): Boolean =
            srcProviderId != dstProviderId && family[srcProviderId] != null && family[srcProviderId] == family[dstProviderId]
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
}
