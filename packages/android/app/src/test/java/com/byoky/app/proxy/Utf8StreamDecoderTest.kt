package com.byoky.app.proxy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Streamed bodies must survive read boundaries that split a multi-byte UTF-8
 * character (the iOS bug: per-chunk decoding dropped or mangled them).
 */
class Utf8StreamDecoderTest {

    // 1-, 2-, 3- and 4-byte characters, including a surrogate pair, inside an SSE frame.
    private val text = "data: {\"t\":\"aé€😀中文 ✓ — Ünïcødé 🧪🔑\"}\n\n"
    private val bytes = text.toByteArray(Charsets.UTF_8)

    private fun decodeChunks(chunks: List<ByteArray>): String {
        val decoder = Utf8StreamDecoder()
        val sb = StringBuilder()
        chunks.forEach { sb.append(decoder.decode(it, it.size)) }
        sb.append(decoder.finish())
        return sb.toString()
    }

    @Test
    fun everySingleSplitPointRoundTrips() {
        for (cut in 0..bytes.size) {
            val chunks = listOf(bytes.copyOfRange(0, cut), bytes.copyOfRange(cut, bytes.size))
            val decoded = decodeChunks(chunks)
            assertEquals("split at byte $cut", text, decoded)
            assertFalse("U+FFFD at split $cut", decoded.contains('�'))
        }
    }

    @Test
    fun everyPairOfSplitPointsRoundTrips() {
        for (a in 0..bytes.size) {
            for (b in a..bytes.size) {
                val chunks = listOf(
                    bytes.copyOfRange(0, a),
                    bytes.copyOfRange(a, b),
                    bytes.copyOfRange(b, bytes.size),
                )
                assertEquals("splits at $a/$b", text, decodeChunks(chunks))
            }
        }
    }

    @Test
    fun oneByteAtATimeRoundTrips() {
        assertEquals(text, decodeChunks(bytes.map { byteArrayOf(it) }))
    }

    @Test
    fun usesOnlyTheGivenLengthOfAReusedBuffer() {
        // streamText reads into one reusable buffer; stale bytes past `length` must be ignored.
        val decoder = Utf8StreamDecoder()
        val buffer = ByteArray(64) { 'x'.code.toByte() }
        val sb = StringBuilder()
        var offset = 0
        while (offset < bytes.size) {
            val n = minOf(5, bytes.size - offset)
            System.arraycopy(bytes, offset, buffer, 0, n)
            sb.append(decoder.decode(buffer, n))
            offset += n
        }
        sb.append(decoder.finish())
        assertEquals(text, sb.toString())
    }

    @Test
    fun truncatedStreamEndsWithOneReplacementCharacter() {
        val euro = "€".toByteArray(Charsets.UTF_8)   // 3 bytes
        val decoder = Utf8StreamDecoder()
        assertEquals("ok", decoder.decode("ok".toByteArray() + euro.copyOf(2)))
        assertEquals("�", decoder.finish())
    }

    @Test
    fun malformedBytesStillDecodeToReplacement() {
        val decoder = Utf8StreamDecoder()
        val out = decoder.decode(byteArrayOf('a'.code.toByte(), 0xFF.toByte(), 'b'.code.toByte())) + decoder.finish()
        assertEquals("a�b", out)
    }
}
