package com.byoky.app.proxy

import org.json.JSONObject
import java.util.Base64

/**
 * How a response body travels to the page. Text (core's `isTextContentType`:
 * text/ types, JSON, XML, event streams, JavaScript, form-encoded; a missing type
 * counts as text) goes as string chunks. Anything else (audio from
 * audio/speech, images, PDFs) goes as base64 chunks marked
 * `chunkEncoding: 'base64'`, which the SDK turns back into the exact bytes;
 * decoding it as UTF-8 would corrupt it. Pure, unit-tested.
 */
object ResponseChunks {

    fun isText(contentType: String?): Boolean {
        val type = contentType.orEmpty().substringBefore(';').trim().lowercase()
        if (type.isEmpty() || type.startsWith("text/")) return true
        return TEXT_MARKERS.any { it in type }
    }

    /** BYOKY_PROXY_RESPONSE_CHUNK carrying [bytes] base64 encoded. */
    fun binaryChunk(requestId: String, bytes: ByteArray): JSONObject = JSONObject()
        .put("type", "BYOKY_PROXY_RESPONSE_CHUNK")
        .put("requestId", requestId)
        .put("chunk", Base64.getEncoder().encodeToString(bytes))
        .put("chunkEncoding", "base64")

    private val TEXT_MARKERS = listOf("json", "xml", "event-stream", "javascript", "x-www-form-urlencoded")
}
