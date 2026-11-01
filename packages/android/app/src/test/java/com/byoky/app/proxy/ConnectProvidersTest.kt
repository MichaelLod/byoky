package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectProvidersTest {

    private val openai = Credential(id = "o1", providerId = "openai", label = "openai", createdAt = 1)
    private val claude = Credential(id = "a1", providerId = "anthropic", label = "claude", authMethod = AuthMethod.OAUTH, createdAt = 1)

    @Test
    fun everyRequestedProviderGetsAnEntry() {
        // OpenAI key only: anthropic is served by auto-routing, cohere by nothing.
        val result = ConnectProviders.build(listOf("anthropic", "cohere"), listOf(openai)) { id ->
            if (id == "anthropic") openai else null
        }
        assertEquals(
            listOf(
                ConnectProviders.Entry("anthropic", true, "api_key"),
                ConnectProviders.Entry("cohere", false, "api_key"),
            ),
            result.entries,
        )
        assertEquals(listOf("anthropic"), result.sessionProviders)
    }

    @Test
    fun theAuthMethodIsTheServingKeys() {
        val result = ConnectProviders.build(listOf("anthropic"), listOf(claude)) { claude }
        assertEquals(ConnectProviders.Entry("anthropic", true, "oauth"), result.entries.single())
    }

    @Test
    fun aRequestWithoutProvidersListsTheWalletsKeys() {
        val second = openai.copy(id = "o2")
        val result = ConnectProviders.build(emptyList(), listOf(openai, second, claude)) { error("not asked") }
        assertEquals(
            listOf(ConnectProviders.Entry("openai", true, "api_key"), ConnectProviders.Entry("anthropic", true, "oauth")),
            result.entries,
        )
        assertEquals(listOf("openai", "anthropic"), result.sessionProviders)
    }

    @Test
    fun requestedIdsReadsTheSdksShapeAndSkipsJunk() {
        val providers = JSONArray("""[{"id":"anthropic","required":true},"openai",{"id":"Bad Id"},42,{"x":1},{"id":"anthropic"}]""")
        assertEquals(listOf("anthropic", "openai", "anthropic"), ConnectProviders.requestedIds(providers))
        assertEquals(emptyList<String>(), ConnectProviders.requestedIds(null))
        // Duplicates collapse to one entry.
        assertEquals(1, ConnectProviders.build(listOf("anthropic", "anthropic"), emptyList()) { null }.entries.size)
    }
}
