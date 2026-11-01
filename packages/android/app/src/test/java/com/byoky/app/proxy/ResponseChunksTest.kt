package com.byoky.app.proxy

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class ResponseChunksTest {

    @Test
    fun textTypesStayText() {
        for (type in listOf("application/json", "text/event-stream; charset=utf-8", "text/plain", "application/problem+json",
            "application/xml", "application/javascript", "application/x-www-form-urlencoded", "", null)) {
            assertTrue("$type", ResponseChunks.isText(type))
        }
        for (type in listOf("audio/mpeg", "audio/wav", "image/png", "application/octet-stream", "application/pdf")) {
            assertFalse(type, ResponseChunks.isText(type))
        }
    }

    /** An MP3 frame header and every byte value survive the trip through the bridge message. */
    @Test
    fun binaryChunksRoundTripExactly() {
        val audio = byteArrayOf(0xFF.toByte(), 0xFB.toByte(), 0x90.toByte(), 0x64) + ByteArray(256) { it.toByte() }
        // As the bridge sends it: JSON text, parsed again on the page side.
        val parsed = JSONObject(ResponseChunks.binaryChunk("r1", audio).toString())
        assertEquals("BYOKY_PROXY_RESPONSE_CHUNK", parsed.getString("type"))
        assertEquals("r1", parsed.getString("requestId"))
        assertEquals("base64", parsed.getString("chunkEncoding"))
        assertArrayEquals(audio, Base64.getDecoder().decode(parsed.getString("chunk")))
    }

    /** Within the limit an error body is translated; past it, passed on as sent from the moment it crosses (R2-05). */
    @Test
    fun translatedErrorBodyHoldsOnlyUpToItsLimit() {
        val small = TranslatedErrorBody(limit = 8)
        assertEquals("", small.append("{\"e\":"))
        assertEquals("", small.append("1}"))
        assertEquals("translated:{\"e\":1}", small.finish { "translated:$it" })

        val untranslatable = TranslatedErrorBody(limit = 8)
        assertEquals("", untranslatable.append("<html>"))
        assertEquals("<html>", untranslatable.finish { null })

        val large = TranslatedErrorBody(limit = 8)
        assertEquals("", large.append("01234"))
        assertEquals("0123456789", large.append("56789"))
        assertEquals("-tail", large.append("-tail"))
        assertEquals("", large.finish { throw AssertionError("never translated") })
    }
}
