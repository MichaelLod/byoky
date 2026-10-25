package com.byoky.app.proxy

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same vectors as the `isAllowedProxyRequest` tests in packages/core/tests/proxy-utils.test.ts. */
class EndpointPolicyTest {

    private val cases = listOf(
        Triple("GET", "https://api.openai.com/v1/models", true),
        Triple("GET", "https://api.openai.com/v1/models/gpt-4o", true),
        Triple("GET", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro", true),
        Triple("GET", "https://openrouter.ai/api/v1/models", true),
        Triple("GET", "http://localhost:11434/api/tags", true),
        Triple("GET", "http://localhost:11434/api/version", true),
        Triple("POST", "https://api.anthropic.com/v1/messages?beta=true", true),
        Triple("POST", "https://api.anthropic.com/v1/messages/count_tokens", true),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", true),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", true),
        Triple("POST", "https://api.groq.com/openai/v1/chat/completions", true),
        Triple("POST", "https://api.fireworks.ai/inference/v1/chat/completions", true),
        Triple("POST", "https://api.deepseek.com/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/responses", true),
        Triple("POST", "https://api.openai.com/v1/embeddings", true),
        Triple("POST", "https://api.openai.com/v1/audio/transcriptions", true),
        Triple("POST", "https://api.cohere.com/v2/chat", true),
        Triple("POST", "https://x.openai.azure.com/openai/deployments/gpt4/chat/completions?api-version=2024-10-21", true),
        Triple("POST", "http://localhost:11434/api/chat", true),
        Triple("POST", "http://localhost:11434/api/generate", true),
        Triple("POST", "https://api.anthropic.com/v1/messages/batches", false),
        Triple("GET", "https://api.anthropic.com/v1/messages/batches/b1/results", false),
        Triple("GET", "https://api.openai.com/v1/files", false),
        Triple("GET", "https://api.openai.com/v1/files/f1/content", false),
        Triple("POST", "https://api.openai.com/v1/fine_tuning/jobs", false),
        Triple("POST", "https://api.openai.com/v1/threads/t1/messages", false),
        Triple("GET", "https://api.openai.com/v1/responses/r1", false),
        Triple("GET", "https://api.openai.com/v1/chat/completions", false),
        Triple("DELETE", "https://api.openai.com/v1/models/ft-x", false),
        Triple("POST", "https://api.openai.com/v1/organization/admin_api_keys", false),
        Triple("POST", "https://generativelanguage.googleapis.com/upload/v1beta/files", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/cachedContents", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:tuneModel", false),
        Triple("POST", "https://openrouter.ai/api/v1/keys", false),
        Triple("POST", "https://api.openai.com/v1/foochat", false),
        Triple("PUT", "https://api.anthropic.com/v1/messages", false),
        Triple("POST", "not a url", false),
        // The vectors from the audit write-up.
        Triple("GET", "https://api.openai.com/v1/models", true),
        Triple("GET", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro", true),
        Triple("POST", "https://api.anthropic.com/v1/messages", true),
        Triple("POST", "https://api.openai.com/openai/v1/chat/completions", true),
        Triple("DELETE", "https://api.openai.com/v1/models/x", false),
        Triple("POST", "http://localhost:11434/api/chat", true),
        Triple("GET", "http://localhost:11434/api/tags", true),
    )

    @Test
    fun matchesTheSharedVectors() {
        for ((method, url, allowed) in cases) {
            assertEquals("$method $url", allowed, EndpointPolicy.isAllowed(method, url))
        }
    }

    @Test
    fun comparesPathSegmentsCaseInsensitively() {
        assertFalse(EndpointPolicy.isAllowed("get", "https://api.openai.com/V1/FILES"))
        assertTrue(EndpointPolicy.isAllowed("post", "https://api.openai.com/V1/Chat/Completions"))
    }

    @Test
    fun geminiActionNamesAreCaseSensitive() {
        assertFalse(EndpointPolicy.isAllowed("POST", "https://generativelanguage.googleapis.com/v1beta/models/g:GENERATECONTENT"))
    }

    @Test
    fun suffixesMatchWholeSegmentsOnly() {
        assertTrue(EndpointPolicy.isAllowed("POST", "https://api.cohere.com/foo/chat"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.cohere.com/foochat"))
        assertFalse(EndpointPolicy.isAllowed("GET", "https://api.openai.com/v1/mymodels"))
        assertFalse(EndpointPolicy.isAllowed("GET", "https://generativelanguage.googleapis.com/v1beta/models/g:generateContent"))
    }

    @Test
    fun percentEncodedSegmentsAreDecodedBeforeTheCheck() {
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/%74hreads/t1/messages"))
        assertFalse(EndpointPolicy.isAllowed("GET", "https://api.openai.com/v1/%66iles"))
        assertTrue(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/chat/%63ompletions"))
    }

    @Test
    fun refusesSegmentsThatDontDecodeOrHoldSeparators() {
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/threads%2Ft1/messages"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/files%2Fx/chat/completions"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/x%5Cy/chat/completions"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/x%3By/chat/completions"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/fil%zzes/chat/completions"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/chat/completions%2"))
        assertFalse(EndpointPolicy.isAllowed("POST", "https://api.openai.com/v1/fil%ffes/chat/completions"))
    }

    /** The independent review's probe cases, with core's answers (packages/core/dist, isAllowedProxyRequest). */
    private val reviewCases = listOf(
        Triple("POST", "https://api.openai.com/v1/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions/", true),
        Triple("POST", "https://api.openai.com/v1/chat%2Fcompletions", false),
        Triple("POST", "https://api.openai.com/v1/foo%2Fmessages", false),
        Triple("POST", "https://api.openai.com/v1/messages%2F", false),
        Triple("POST", "https://api.openai.com/v1/files%2F..%2Fchat/completions", false),
        Triple("POST", "https://api.openai.com/v1/x/files%2Fy/chat/completions", false),
        Triple("POST", "https://api.openai.com/v1/%66iles/chat/completions", false),
        Triple("POST", "https://api.openai.com/v1/%2566iles/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/fil%zzes/chat/completions", false),
        Triple("POST", "https://api.openai.com/v1/fil%ffes/chat/completions", false),
        Triple("POST", "https://api.openai.com/v1/files/../chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/files/%2e%2e/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/files/.%2E/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions?x=/files", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions#/files", true),
        Triple("POST", "https://api.openai.com/v1\\files\\..\\chat\\completions", true),
        Triple("POST", "https://api.openai.com/v1/FILES/chat/completions", false),
        Triple("POST", "https://api.openai.com/v1/Chat/Completions", true),
        Triple("post", "https://api.openai.com/v1/chat/completions", true),
        Triple("GET", "https://api.openai.com/v1/models", true),
        Triple("GET", "https://api.openai.com/v1/models/gpt-4o", true),
        Triple("GET", "https://api.openai.com/v1/models/gpt-4o/", true),
        Triple("GET", "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent", true),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:GenerateContent", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro%3AstreamGenerateContent?alt=sse", true),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/cachedContents/x:generateContent", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/models/a%2Fb:generateContent", false),
        Triple("POST", "https://generativelanguage.googleapis.com/v1beta/files%2Fx:generateContent", false),
        Triple("DELETE", "https://api.openai.com/v1/models/ft-x", false),
        Triple("HEAD", "https://api.openai.com/v1/models", false),
        Triple("POST", "https://api.anthropic.com/v1/messages/count_tokens", true),
        Triple("POST", "https://api.anthropic.com/v1/messages/batches", false),
        Triple("POST", "https://api.openai.com/v1/responses/resp_1/cancel", false),
        Triple("GET", "https://api.openai.com/v1/responses/resp_1", false),
        Triple("POST", "http://localhost:11434/api/chat", true),
        Triple("GET", "http://localhost:11434/api/tags", true),
        Triple("POST", "http://localhost:11434/api/pull", false),
        Triple("POST", "https://api.openai.com/v1/%E2%80%8Bfiles/chat/completions", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions%00", false),
        Triple("POST", "https://api.openai.com//v1//chat//completions", true),
        Triple("POST", "https://api.openai.com/v1/./chat/./completions", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions/.", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions/..", true),
        Triple("POST", "https://api.openai.com/v1/chat/completions/%2e", true),
    )

    @Test
    fun agreesWithCoreOnTheReviewCases() {
        for ((method, url, allowed) in reviewCases) {
            assertEquals("$method $url", allowed, EndpointPolicy.isAllowed(method, url))
        }
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
