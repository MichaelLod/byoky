package com.byoky.app.proxy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The mobile bundle's rewriteRequestModel answer, as ProxyService reads it (R3-05). */
class ModelRewriteTest {

    @Test
    fun readsTheFittedBody() {
        val body = """{"model":"gpt-5.5","max_completion_tokens":64}"""
        assertEquals(
            ModelRewrite.Body(body),
            ModelRewrite.parse(org.json.JSONObject().put("body", body).toString()),
        )
    }

    @Test
    fun readsARefusalWrittenForTheApp() {
        assertEquals(
            ModelRewrite.Refused("UNSUPPORTED_FEATURE", "OpenAI's Chat Completions API doesn't take tools for gpt-6-astra"),
            ModelRewrite.parse("""{"error":{"code":"UNSUPPORTED_FEATURE","message":"OpenAI's Chat Completions API doesn't take tools for gpt-6-astra"}}"""),
        )
    }

    @Test
    fun anythingElseIsNoAnswer() {
        // An older bundle without the export answers '' (the caller then only renames the model).
        for (json in listOf("", "not json", "{}", """{"body":1}""", """{"error":{"code":"X"}}""", "[]")) {
            assertNull(json, ModelRewrite.parse(json))
        }
    }
}
