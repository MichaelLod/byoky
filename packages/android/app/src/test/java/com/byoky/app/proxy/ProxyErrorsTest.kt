package com.byoky.app.proxy

import com.byoky.app.runtime.PageError
import org.junit.Assert.assertEquals
import org.junit.Test

/** Proxy error codes and statuses match the extension and iOS (docs error table). */
class ProxyErrorsTest {

    @Test
    fun statusesFollowTheCode() {
        assertEquals(401, ProxyService.statusFor("SESSION_EXPIRED"))
        assertEquals(403, ProxyService.statusFor("PROVIDER_UNAVAILABLE"))
        assertEquals(403, ProxyService.statusFor("INVALID_URL"))
        assertEquals(403, ProxyService.statusFor(EndpointPolicy.ERROR_CODE))
        assertEquals(400, ProxyService.statusFor("ROUTING_UNSUPPORTED"))
        assertEquals(400, ProxyService.statusFor("TRANSLATION_NOT_SUPPORTED"))
        assertEquals(429, ProxyService.statusFor("QUOTA_EXCEEDED"))
        for (code in listOf("PROXY_ERROR", "TRANSLATION_FAILED", "SWAP_FAILED")) {
            assertEquals(code, 502, ProxyService.statusFor(code))
        }
    }

    /** No key, no usable key, no server URL, unknown provider: all the documented PROVIDER_UNAVAILABLE. */
    @Test
    fun unusableSetupsAreProviderUnavailable() {
        for (error in listOf(
            ProxyService.unknownProvider("nope"),
            ProxyService.unusableKey("OpenAI", "Work"),
            ProxyService.missingBaseUrl("Ollama (local)", "Laptop"),
            ProxyService.ProxyError("PROVIDER_UNAVAILABLE", "No openai API key found."),
        )) {
            val page = PageError.from(error)
            assertEquals("PROVIDER_UNAVAILABLE", page.code)
            assertEquals(403, page.status)
        }
        assertEquals(
            "The Ollama (local) key \"Laptop\" has no server URL. Tap the key in your wallet to add its endpoint.",
            ProxyService.missingBaseUrl("Ollama (local)", "Laptop").message,
        )
    }

    @Test
    fun upstreamRequestsAllowSlowGenerations() {
        // Non-streaming replies send headers only once generation ends.
        assertEquals(600_000, ProxyService.newUpstreamClient().readTimeoutMillis)
        assertEquals(false, ProxyService.newUpstreamClient().followRedirects)
    }
}
