package com.byoky.app.data

import org.json.JSONObject

/**
 * Token usage in provider responses. Mirrors `parseUsage` /
 * `extractUsageFromParsed` in packages/core/src/proxy-utils.ts, including
 * Anthropic prompt-cache tokens as input, embeddings (prompt tokens only)
 * and the Responses API. Streams are read incrementally by [UsageMeter].
 */
object UsageParser {

    data class TokenUsage(val inputTokens: Int, val outputTokens: Int)

    fun parseModel(body: ByteArray?): String? {
        if (body == null || body.size > 10_485_760) return null
        return try {
            val json = JSONObject(String(body, Charsets.UTF_8))
            json.optString("model", "").ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    /** Usage in a complete response body (JSON or SSE), or null. */
    fun parseUsage(providerId: String, body: String): TokenUsage? {
        val meter = UsageMeter(providerId)
        meter.onText(body)
        return meter.usage()
    }

    /** Usage in one parsed response object or stream frame, or null. */
    fun extractUsage(providerId: String, parsed: JSONObject): TokenUsage? {
        // Anthropic: { usage: { input_tokens, output_tokens, cache_*_input_tokens } }
        if (providerId == "anthropic") {
            anthropicUsage(parsed.optJSONObject("usage"))?.let { (input, output) ->
                if (input != null && output != null) return sanitize(input, output)
            }
        }

        // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount, thoughtsTokenCount } }
        if (providerId == "gemini") {
            val meta = parsed.optJSONObject("usageMetadata")
            if (meta != null && meta.has("promptTokenCount")) {
                // Thinking tokens are billed as output.
                val output = meta.optLong("candidatesTokenCount", 0) + meta.optLong("thoughtsTokenCount", 0)
                return sanitize(meta.optLong("promptTokenCount", 0), output)
            }
        }

        // Cohere v2: { usage: { tokens: { input_tokens, output_tokens } } }
        if (providerId == "cohere") {
            cohereTokens(parsed.optJSONObject("usage"))?.let { return it }
        }

        // Groq streaming: usage under x_groq.usage instead of top-level usage.
        if (providerId == "groq") {
            val groq = parsed.optJSONObject("x_groq")?.optJSONObject("usage")
            if (groq != null && groq.has("prompt_tokens") && groq.has("completion_tokens")) {
                return sanitize(groq.optLong("prompt_tokens"), groq.optLong("completion_tokens"))
            }
        }

        // OpenAI-compatible: { usage: { prompt_tokens, completion_tokens } }
        val usage = parsed.optJSONObject("usage")
        if (usage != null && usage.has("prompt_tokens") && usage.has("completion_tokens")) {
            return sanitize(usage.optLong("prompt_tokens"), usage.optLong("completion_tokens"))
        }
        // Embeddings report prompt tokens only.
        if (usage != null && usage.has("prompt_tokens") && !usage.has("completion_tokens") && !usage.has("input_tokens")) {
            return sanitize(usage.optLong("prompt_tokens"), 0)
        }

        // Responses API: { usage: { input_tokens, output_tokens } }; in streams the
        // final `response.completed` event carries the whole response.
        val responses = if (parsed.optString("type") == "response.completed") {
            parsed.optJSONObject("response")?.optJSONObject("usage")
        } else usage
        if (responses != null && responses.has("input_tokens") && responses.has("output_tokens")) {
            return sanitize(responses.optLong("input_tokens"), responses.optLong("output_tokens"))
        }
        return null
    }

    /** Input (with cache tokens) and output of an Anthropic usage object; either may be missing. */
    internal fun anthropicUsage(usage: JSONObject?): Pair<Long?, Long?>? {
        if (usage == null) return null
        val input = if (usage.has("input_tokens")) {
            usage.optLong("input_tokens") +
                usage.optLong("cache_creation_input_tokens", 0) +
                usage.optLong("cache_read_input_tokens", 0)
        } else null
        val output = if (usage.has("output_tokens")) usage.optLong("output_tokens") else null
        return input to output
    }

    internal fun cohereTokens(usage: JSONObject?): TokenUsage? {
        val tokens = usage?.optJSONObject("tokens") ?: return null
        if (!tokens.has("input_tokens") || !tokens.has("output_tokens")) return null
        return sanitize(tokens.optLong("input_tokens"), tokens.optLong("output_tokens"))
    }

    internal fun sanitize(input: Long, output: Long): TokenUsage =
        TokenUsage(input.coerceIn(0, Int.MAX_VALUE.toLong()).toInt(), output.coerceIn(0, Int.MAX_VALUE.toLong()).toInt())
}
