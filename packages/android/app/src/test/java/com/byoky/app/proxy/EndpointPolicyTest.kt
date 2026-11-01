package com.byoky.app.proxy

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The endpoint vectors are shared with core's `isAllowedProxyRequest` and
 * iOS: packages/core/tests/vectors/endpoint-policy.json, on the test
 * classpath via app/build.gradle.kts. A case's "android" key, when present,
 * overrides "allowed" for this wallet. Add new cases to that file.
 */
class EndpointPolicyTest {

    private fun sharedCases(): List<Triple<String, String, Boolean>> {
        val cases = SharedVectors.load("endpoint-policy.json").getJSONArray("cases")
        return (0 until cases.length()).map { i ->
            val c = cases.getJSONObject(i)
            val allowed = if (c.has("android")) c.getBoolean("android") else c.getBoolean("allowed")
            Triple(c.getString("method"), c.getString("url"), allowed)
        }
    }

    @Test
    fun matchesTheSharedVectors() {
        val cases = sharedCases()
        assertTrue("expected the shared vectors, got ${cases.size}", cases.size > 100)
        val failures = cases
            .filter { (method, url, allowed) -> EndpointPolicy.isAllowed(method, url) != allowed }
            .map { (method, url, allowed) -> "$method $url: expected $allowed" }
        assertEquals("disagrees with endpoint-policy.json", emptyList<String>(), failures)
    }

    /** Same vectors as the `shouldEstimateUsage` tests in packages/core/tests/proxy-utils.test.ts. */
    @Test
    fun estimatesOnlyTextGeneration() {
        val cases = listOf(
            listOf("openai", "https://api.openai.com/v1/chat/completions", "text/event-stream", true),
            listOf("anthropic", "https://api.anthropic.com/v1/messages", "application/json", true),
            listOf("gemini", "https://generativelanguage.googleapis.com/v1beta/models/g:streamGenerateContent?alt=sse", "text/event-stream", true),
            listOf("openai", "https://api.openai.com/v1/responses", "application/json; charset=utf-8", true),
            listOf("openai", "https://api.openai.com/v1/embeddings", "application/json", false),
            listOf("openai", "https://api.openai.com/v1/images/generations", "application/json", false),
            listOf("openai", "https://api.openai.com/v1/audio/speech", "audio/mpeg", false),
            listOf("openai", "https://api.openai.com/v1/chat/completions", "text/html", false),
            listOf("anthropic", "https://api.anthropic.com/v1/messages/count_tokens", "application/json", false),
            listOf("ollama", "http://localhost:11434/api/chat", "application/x-ndjson", false),
            listOf("lm_studio", "http://localhost:1234/v1/chat/completions", "application/json", false),
        )
        for ((provider, url, type, expected) in cases) {
            assertEquals("$provider $url $type", expected,
                EndpointPolicy.shouldEstimateUsage(provider as String, (url as String).toHttpUrl(), type as String))
        }
    }
}
