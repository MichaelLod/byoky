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

    /** F003. Same cases as the `isModelPinnableRequest` tests in packages/core/tests/proxy-utils.test.ts. */
    @Test
    fun pinsModelsOnlyForGenerationAndTokenCounts() {
        val gemini = "https://generativelanguage.googleapis.com/v1beta/models"
        val cases = listOf(
            "https://api.openai.com/v1/chat/completions" to true,
            "https://api.openai.com/v1/completions" to true,
            "https://api.openai.com/v1/responses" to true,
            "https://api.openai.com/v1/responses/input_tokens" to true,
            "https://api.anthropic.com/v1/messages?beta=true" to true,
            "https://api.anthropic.com/v1/messages/count_tokens" to true,
            "https://api.cohere.com/v2/chat" to true,
            "http://localhost:11434/api/generate" to true,
            "http://localhost:11434/api/chat" to true,
            "https://api.groq.com/openai/v1/chat/completions" to true,
            "$gemini/gemini-2.5-flash:generateContent" to true,
            "$gemini/gemini-2.5-flash:streamGenerateContent?alt=sse" to true,
            "$gemini/gemini-2.5-flash:countTokens" to true,
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" to true,
            "https://api.openai.com/v1/embeddings" to false,
            "https://api.openai.com/v1/moderations" to false,
            "https://api.openai.com/v1/audio/speech" to false,
            "https://api.openai.com/v1/audio/transcriptions" to false,
            "https://api.openai.com/v1/images/generations" to false,
            "https://api.openai.com/v1/images/edits" to false,
            "https://api.cohere.com/v2/embed" to false,
            "https://api.cohere.com/v2/rerank" to false,
            "https://api.mistral.ai/v1/fim/completions" to false,
            "http://localhost:11434/api/embed" to false,
            "http://localhost:11434/api/show" to false,
            "$gemini/text-embedding-004:embedContent" to false,
            "$gemini/text-embedding-004:batchEmbedContents" to false,
            "https://api.openai.com/v1/models" to false,
            "not a url" to false,
        )
        val failures = cases
            .filter { (url, expected) -> EndpointPolicy.isModelPinnable(url) != expected }
            .map { (url, expected) -> "$url: expected $expected" }
        assertEquals(emptyList<String>(), failures)
    }
}
