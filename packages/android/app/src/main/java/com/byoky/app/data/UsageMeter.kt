package com.byoky.app.data

import org.json.JSONObject

/**
 * Reads token usage from a response while it streams past, so usage counts
 * however large the response gets. SSE frames are parsed one line at a time;
 * a plain JSON body is buffered up to [JSON_LIMIT] and parsed at the end,
 * and past that only its tail is searched for the usage object.
 *
 * [counted] is what goes against the app's allowance: the parsed usage, or,
 * for text generation (see `EndpointPolicy.shouldEstimateUsage`), an
 * estimate of request and response size / 4 when the reply carried none or
 * was cut off part-way. Only 2xx responses count. Mirrors the extension's
 * `recordProxyUsage`.
 *
 * Not thread-safe; one meter per request, fed from the thread that reads
 * the response. Pure, unit-tested.
 */
class UsageMeter(
    /** The provider whose dialect the response is in (the upstream one when routed). */
    private val providerId: String,
) {
    /** Upstream HTTP status; 0 while no response has arrived. */
    var status: Int = 0
    /** Size of the app's request body, for the input estimate. */
    var requestBytes: Long = 0
    /** Response content type ("" until the response arrives). */
    var contentType: String = ""
        set(value) {
            field = value
            eventStream = value.lowercase().contains("text/event-stream")
        }
    /** True once the whole response body was read. */
    var complete: Boolean = false

    /** `text/event-stream` responses are never buffered as JSON. */
    private var eventStream = false
    private var responseChars = 0L

    private val line = StringBuilder()
    private var skippingLine = false
    private var sawFrames = false
    private var frameUsage: UsageParser.TokenUsage? = null
    private var anthropicInput: Long? = null
    private var anthropicOutput: Long? = null

    private val json = StringBuilder()
    private var jsonOverflowed = false
    private val tail = StringBuilder()

    private var finished: UsageParser.TokenUsage? = null
    private var isFinished = false

    fun onText(text: String) {
        if (text.isEmpty()) return
        responseChars += text.length
        scanLines(text)
        if (!eventStream) bufferJson(text)
    }

    /** Usage the response reported, or null when it carried none (or only part of it). */
    fun usage(): UsageParser.TokenUsage? {
        if (!isFinished) {
            finished = computeUsage()
            isFinished = true
        }
        return finished
    }

    /**
     * What this request counts against the allowance; null for anything but
     * a 2xx response. [estimate]: the endpoint and content type qualify for
     * an estimate (`EndpointPolicy.shouldEstimateUsage`).
     */
    fun counted(estimate: Boolean): UsageLedger.Usage? {
        if (status !in 200..299) return null
        val parsed = usage()
        var input = parsed?.inputTokens?.toLong() ?: 0
        var output = parsed?.outputTokens?.toLong() ?: 0
        // No usage block, or a stream cut off before its final one: fill in
        // what's missing at about 4 characters per token, keeping any input
        // count the stream did report.
        if (estimate && (parsed == null || !complete)) {
            if (input == 0L) input = anthropicInput ?: ((requestBytes + 3) / 4)
            if (output == 0L) output = (responseChars + 3) / 4
        }
        return UsageLedger.Usage(1, input, output)
    }

    // ── SSE ──────────────────────────────────────────────────────────────

    private fun scanLines(text: String) {
        var start = 0
        while (start < text.length) {
            val nl = text.indexOf('\n', start)
            val end = if (nl < 0) text.length else nl
            if (!skippingLine) {
                if (line.length + (end - start) > MAX_LINE) {
                    // A line this long is not a usage frame; drop it.
                    line.setLength(0)
                    skippingLine = true
                } else {
                    line.append(text, start, end)
                }
            }
            if (nl < 0) break
            if (!skippingLine) handleLine(line.toString())
            line.setLength(0)
            skippingLine = false
            start = nl + 1
        }
    }

    private fun handleLine(raw: String) {
        val l = raw.trimEnd('\r')
        if (!l.startsWith("data:")) return
        val payload = l.removePrefix("data:").removePrefix(" ")
        if (payload.isEmpty() || payload.startsWith("[DONE]")) return
        val frame = try { JSONObject(payload) } catch (_: Exception) { return }
        sawFrames = true
        when (providerId) {
            // input_tokens arrive in message_start, output_tokens in message_delta.
            "anthropic" -> when (frame.optString("type")) {
                "message_start" -> UsageParser.anthropicUsage(frame.optJSONObject("message")?.optJSONObject("usage"))
                    ?.first?.let { anthropicInput = it }
                "message_delta" -> UsageParser.anthropicUsage(frame.optJSONObject("usage"))?.let { (input, output) ->
                    if (input != null) anthropicInput = input
                    if (output != null) anthropicOutput = output
                }
                else -> UsageParser.extractUsage(providerId, frame)?.let { frameUsage = it }
            }
            // Usage is on the final message-end frame, under delta.usage.tokens.
            "cohere" -> if (frame.optString("type") == "message-end") {
                UsageParser.cohereTokens(frame.optJSONObject("delta")?.optJSONObject("usage"))?.let { frameUsage = it }
            } else {
                UsageParser.extractUsage(providerId, frame)?.let { frameUsage = it }
            }
            else -> UsageParser.extractUsage(providerId, frame)?.let { frameUsage = it }
        }
    }

    // ── JSON ─────────────────────────────────────────────────────────────

    private fun bufferJson(text: String) {
        if (!jsonOverflowed) {
            if (json.length + text.length > JSON_LIMIT) {
                jsonOverflowed = true
                json.setLength(0)
            } else {
                json.append(text)
            }
        }
        tail.append(text)
        if (tail.length > 2 * TAIL_LENGTH) tail.delete(0, tail.length - TAIL_LENGTH)
    }

    private fun computeUsage(): UsageParser.TokenUsage? {
        // A last line without a trailing newline is still a frame.
        if (!skippingLine && line.isNotEmpty()) {
            handleLine(line.toString())
            line.setLength(0)
        }
        if (sawFrames) {
            if (providerId == "anthropic") {
                val input = anthropicInput
                val output = anthropicOutput
                if (input != null && output != null) return UsageParser.sanitize(input, output)
            }
            return frameUsage
        }
        if (eventStream) return null
        if (!jsonOverflowed) {
            val parsed = try { JSONObject(json.toString()) } catch (_: Exception) { null } ?: return null
            return UsageParser.extractUsage(providerId, parsed)
        }
        return usageFromTail(tail.toString())
    }

    /**
     * Read the last `"usage": {…}` (Gemini: `"usageMetadata"`) in the tail of
     * a body too large to parse whole. Every provider puts it after the
     * generated content, and model text can't fake one there (quotes inside
     * JSON strings are escaped), so only the last occurrence is trusted.
     */
    private fun usageFromTail(text: String): UsageParser.TokenUsage? {
        val key = if (providerId == "gemini") "usageMetadata" else "usage"
        val quoted = "\"$key\""
        var from = text.length
        while (from > 0) {
            val at = text.lastIndexOf(quoted, from - 1)
            if (at < 0) return null
            from = at
            var i = at + quoted.length
            while (i < text.length && text[i].isWhitespace()) i++
            if (i >= text.length || text[i] != ':') continue
            i++
            while (i < text.length && text[i].isWhitespace()) i++
            if (i >= text.length || text[i] != '{') continue
            val end = objectEnd(text, i) ?: return null
            val obj = try { JSONObject(text.substring(i, end + 1)) } catch (_: Exception) { return null }
            return UsageParser.extractUsage(providerId, JSONObject().put(key, obj))
        }
        return null
    }

    /** Index of the brace closing the object that opens at [start], skipping string contents. */
    private fun objectEnd(text: String, start: Int): Int? {
        var depth = 0
        var inString = false
        var escaped = false
        for (i in start until text.length) {
            val c = text[i]
            if (inString) {
                when {
                    escaped -> escaped = false
                    c == '\\' -> escaped = true
                    c == '"' -> inString = false
                }
                continue
            }
            when (c) {
                '"' -> inString = true
                '{' -> depth++
                '}' -> if (--depth == 0) return i
            }
        }
        return null
    }

    companion object {
        /** Plain JSON bodies up to this many characters are parsed whole. */
        const val JSON_LIMIT = 2 * 1024 * 1024
        /** How much of a larger body's end is searched for the usage object. */
        const val TAIL_LENGTH = 64 * 1024
        /** SSE lines longer than this are skipped (usage frames are tiny). */
        const val MAX_LINE = 1024 * 1024
    }
}
