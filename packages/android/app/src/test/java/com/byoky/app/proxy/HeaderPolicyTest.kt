package com.byoky.app.proxy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class HeaderPolicyTest {

    @Test
    fun onlyAllowedHeadersAreForwarded() {
        val out = HeaderPolicy.forwardedHeaders(mapOf(
            "Content-Type" to "application/json",
            "Anthropic-Version" to "2023-06-01",
            "X-Stainless-OS" to "MacOS",
            "Cookie" to "sid=1",
            "Origin" to "https://app.example",
            "Referer" to "https://app.example/page",
            "Accept-Encoding" to "gzip",
            "X-HTTP-Method-Override" to "DELETE",
            "X-Goog-User-Project" to "someone-elses-project",
            "X-Goog-Api-Key" to "placeholder",
            "Authorization" to "Bearer from-page",
            "Proxy-Authorization" to "Basic x",
            "Connection" to "upgrade",
        ))
        assertEquals(mapOf("content-type" to "application/json", "anthropic-version" to "2023-06-01"), out)
    }

    @Test
    fun valuesOkHttpWouldRejectDropTheHeader() {
        val out = HeaderPolicy.forwardedHeaders(mapOf(
            "user-agent" to "app\r\nx-injected: 1",
            "x-app" to "nul\u0000",
            "openai-project" to "projé",
            "accept" to "application/json,\ttext/event-stream",
        ))
        assertEquals(mapOf("accept" to "application/json,\ttext/event-stream"), out)
    }

    @Test
    fun routedRequestsDropTheSourceDialectsVersion() {
        val out = HeaderPolicy.forwardedHeaders(
            mapOf("anthropic-version" to "2023-06-01", "anthropic-beta" to "tools"),
            HeaderPolicy.ROUTED_EXCLUDED,
        )
        assertFalse("anthropic-version" in out)
        assertEquals("tools", out["anthropic-beta"])
    }

    /** Same list as core's FORWARDABLE_HEADERS and iOS's ProxyPolicy.forwardableHeaders. */
    @Test
    fun theAllowListMatchesCore() {
        assertEquals(
            setOf(
                "content-type", "accept", "anthropic-version", "anthropic-beta",
                "anthropic-dangerous-direct-browser-access", "x-app", "user-agent", "x-client-name",
                "openai-organization", "openai-project", "openai-beta", "x-goog-api-client",
            ),
            HeaderPolicy.FORWARDABLE,
        )
    }
}
