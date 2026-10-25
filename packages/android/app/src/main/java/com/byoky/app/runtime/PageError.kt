package com.byoky.app.runtime

import com.byoky.app.proxy.ProxyService
import com.byoky.app.proxy.TranslationEngine
import java.io.IOException

/**
 * The error an app sees for a failed proxy request. Only [ProxyService.ProxyError]
 * carries a message written for the app; every other exception maps to a
 * fixed code and text. Raw exception text never reaches the page: OkHttp's
 * header validation, for one, quotes the offending header value, which can
 * be the API key. Pure, unit-tested.
 */
data class PageError(val code: String, val message: String, val status: Int) {
    companion object {
        fun from(e: Throwable): PageError = when (e) {
            is ProxyService.ProxyError -> PageError(e.code, e.message ?: e.code, e.status)
            is TranslationEngine.EngineException.TooLarge -> PageError(
                "TRANSLATION_FAILED",
                "This request is too large to translate for the provider this app is routed to.",
                413,
            )
            is TranslationEngine.EngineException -> PageError(
                "TRANSLATION_FAILED",
                "The request couldn't be translated for the provider this app is routed to.",
                502,
            )
            is IOException -> PageError("PROXY_ERROR", "Couldn't reach the provider. Check the connection and try again.", 502)
            else -> PageError("PROXY_ERROR", "Request failed", 502)
        }
    }
}
