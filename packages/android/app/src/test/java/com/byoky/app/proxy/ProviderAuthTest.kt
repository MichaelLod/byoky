package com.byoky.app.proxy

import com.byoky.app.data.AuthMethod
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Header shaping parity with core `buildHeaders` (packages/core/src/proxy-utils.ts).
 * The Anthropic expectations are core's real output for the same inputs.
 */
class ProviderAuthTest {

    private fun apply(providerId: String, method: AuthMethod, key: String, vararg incoming: Pair<String, String>) =
        mutableMapOf(*incoming).also { ProviderAuth.apply(it, providerId, method, key) }

    @Test
    fun anthropicSetupTokenMatchesCore() {
        val h = apply(
            "anthropic", AuthMethod.OAUTH, "sk-ant-oat01-T",
            "anthropic-beta" to "context-1m-2025-08-07,tools-2024-04-04",
            "content-type" to "application/json",
        )
        assertEquals(
            mapOf(
                "anthropic-beta" to "tools-2024-04-04,claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
                "content-type" to "application/json",
                "authorization" to "Bearer sk-ant-oat01-T",
                "user-agent" to "claude-cli/2.1.76",
                "x-app" to "cli",
                "accept" to "application/json",
                "anthropic-version" to "2023-06-01",
                "anthropic-dangerous-direct-browser-access" to "true",
            ),
            h,
        )
    }

    @Test
    fun anthropicApiKeyDropsLongContextBetaAndKeepsAppVersion() {
        val h = apply(
            "anthropic", AuthMethod.API_KEY, "sk-ant-api03-T",
            "anthropic-beta" to "context-1m-2025-08-07",
            "anthropic-version" to "2024-01-01",
        )
        assertEquals(
            mapOf(
                "anthropic-version" to "2024-01-01",
                "x-api-key" to "sk-ant-api03-T",
                "anthropic-dangerous-direct-browser-access" to "true",
            ),
            h,
        )
    }

    @Test
    fun translatedRequestsToAnthropicGetAVersionHeader() {
        // The translated route drops the app's anthropic-version (it spoke
        // another dialect); Anthropic rejects requests without one.
        assertEquals("2023-06-01", apply("anthropic", AuthMethod.OAUTH, "t")["anthropic-version"])
        assertEquals("2023-06-01", apply("anthropic", AuthMethod.API_KEY, "k")["anthropic-version"])
    }

    @Test
    fun otherProviders() {
        assertEquals(mapOf("api-key" to "az"), apply("azure_openai", AuthMethod.API_KEY, "az"))
        assertEquals(mapOf("x-goog-api-key" to "AIza"), apply("gemini", AuthMethod.API_KEY, "AIza"))
        assertEquals(mapOf("authorization" to "Bearer sk"), apply("openai", AuthMethod.API_KEY, "sk"))
        assertEquals(mapOf("authorization" to "Bearer lm"), apply("lm_studio", AuthMethod.API_KEY, "lm"))
        assertFalse(apply("ollama", AuthMethod.API_KEY, "").containsKey("authorization"))
    }
}
