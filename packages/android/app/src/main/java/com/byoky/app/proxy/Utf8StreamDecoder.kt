package com.byoky.app.proxy

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CoderResult
import java.nio.charset.CodingErrorAction

/**
 * Incremental UTF-8 decoder for streamed response bodies. A network read can
 * end in the middle of a multi-byte character; decoding each read on its own
 * would turn both halves into U+FFFD. This keeps the incomplete tail and
 * prepends it to the next read. Genuinely malformed bytes still become U+FFFD,
 * and a sequence left incomplete when the stream ends is replaced by
 * [finish].
 *
 * Not thread-safe; use one instance per stream.
 */
internal class Utf8StreamDecoder {
    private val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
    private var pending = ByteArray(0)

    /** Decode `bytes[0 until length]`, holding back an incomplete trailing sequence. */
    fun decode(bytes: ByteArray, length: Int = bytes.size): String {
        val input = ByteBuffer.wrap(pending + bytes.copyOf(length))
        val text = drain(input, endOfInput = false)
        pending = ByteArray(input.remaining()).also { input.get(it) }
        return text
    }

    /** End of stream: emit whatever is still held back. */
    fun finish(): String {
        val input = ByteBuffer.wrap(pending)
        pending = ByteArray(0)
        val sb = StringBuilder(drain(input, endOfInput = true))
        val out = CharBuffer.allocate(8)
        decoder.flush(out)
        out.flip()
        sb.append(out)
        decoder.reset()
        return sb.toString()
    }

    private fun drain(input: ByteBuffer, endOfInput: Boolean): String {
        val sb = StringBuilder()
        val out = CharBuffer.allocate(maxOf(16, input.remaining() + 1))
        while (true) {
            val result: CoderResult = decoder.decode(input, out, endOfInput)
            out.flip()
            sb.append(out)
            out.clear()
            if (!result.isOverflow) break
        }
        return sb.toString()
    }
}
