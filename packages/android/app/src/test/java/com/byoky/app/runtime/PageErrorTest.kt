package com.byoky.app.runtime

import com.byoky.app.proxy.EndpointPolicy
import com.byoky.app.proxy.ProxyService
import com.byoky.app.proxy.TranslationEngine
import okhttp3.Headers.Companion.toHeaders
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test
import java.net.SocketTimeoutException

class PageErrorTest {

    @Test
    fun okHttpsHeaderErrorNeverReachesThePage() {
        // A key pasted with a zero-width space: OkHttp's message quotes the value.
        val key = "sk-ant-api03-SECRET​VALUE"
        val thrown = try {
            mapOf("x-api-key" to key).toHeaders()
            fail("OkHttp accepted a non-ASCII header value")
            return
        } catch (e: IllegalArgumentException) {
            e
        }
        val error = PageError.from(thrown)
        assertEquals("PROXY_ERROR", error.code)
        assertFalse(error.message.contains("SECRET"))
        assertFalse(error.message.contains("x-api-key"))
    }

    @Test
    fun otherFailuresGetFixedTexts() {
        assertEquals(
            PageError("PROXY_ERROR", "Couldn't reach the provider. Check the connection and try again.", 502),
            PageError.from(SocketTimeoutException("timeout talking to 10.0.0.1")),
        )
        val translation = PageError.from(TranslationEngine.EngineException.TranslationFailed("Unexpected token in {\"secret\":1}"))
        assertEquals("TRANSLATION_FAILED", translation.code)
        assertFalse(translation.message.contains("secret"))
        assertEquals(413, PageError.from(TranslationEngine.EngineException.TooLarge()).status)
    }

    @Test
    fun proxyErrorsAreWrittenForTheAppAndPassThrough() {
        assertEquals(
            PageError("ENDPOINT_NOT_ALLOWED", "Apps can only call inference and model-listing endpoints through Byoky", 403),
            PageError.from(ProxyService.endpointNotAllowed()),
        )
        assertEquals(EndpointPolicy.ERROR_CODE, PageError.from(ProxyService.endpointNotAllowed()).code)
        assertEquals(
            PageError("QUOTA_EXCEEDED", "Token allowance exceeded for https://a.example", 429),
            PageError.from(ProxyService.ProxyError("QUOTA_EXCEEDED", "Token allowance exceeded for https://a.example", 429)),
        )
    }
}
