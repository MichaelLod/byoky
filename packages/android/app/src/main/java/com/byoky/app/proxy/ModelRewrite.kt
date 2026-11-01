package com.byoky.app.proxy

import org.json.JSONObject

/**
 * What core's `rewriteRequestModel` made of a request whose group pins
 * another model of the app's own family (see
 * [TranslationEngine.rewriteRequestModel]). Pure, unit-tested.
 */
sealed class ModelRewrite {
    /** The body with the pinned model, fitted to that model's request rules. */
    data class Body(val body: String) : ModelRewrite()

    /** The model can't serve the request; [message] is written for the app. */
    data class Refused(val code: String, val message: String) : ModelRewrite()

    companion object {
        /** The bridge's JSON answer, or null for anything else. */
        fun parse(json: String): ModelRewrite? = try {
            val answer = JSONObject(json)
            val error = answer.optJSONObject("error")
            when {
                answer.opt("body") is String -> Body(answer.getString("body"))
                error != null && error.opt("code") is String && error.opt("message") is String ->
                    Refused(error.getString("code"), error.getString("message"))
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }
}
