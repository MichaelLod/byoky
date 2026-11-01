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

/**
 * A translated request's error body (non-2xx). It is held for translation
 * into the app's dialect only up to [limit] characters: once it grows past
 * that, what was held and everything after it is passed on as sent, as it
 * arrives, so a huge or endless error body is never read into memory whole.
 * Pure, unit-tested.
 */
class TranslatedErrorBody(private val limit: Int) {
    private val held = StringBuilder()
    private var passingThrough = false

    /** Take the next text of the body; returns what to deliver now (empty while it is held). */
    fun append(text: String): String {
        if (passingThrough) return text
        held.append(text)
        if (held.length <= limit) return ""
        passingThrough = true
        val out = held.toString()
        held.setLength(0)
        return out
    }

    /**
     * The body ended: the rest to deliver. A body within the limit goes
     * through [translate], and as sent when that gives null.
     */
    fun finish(translate: (String) -> String?): String {
        if (passingThrough) return ""
        val body = held.toString()
        held.setLength(0)
        return translate(body) ?: body
    }
}
