package com.byoky.app.data

import org.json.JSONObject

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

    fun parseUsage(providerId: String, body: String): TokenUsage? {
        // Streaming (SSE) — scan data: lines from the end
        if (body.contains("data: ")) {
            val lines = body.split("\n")
                .filter { it.startsWith("data: ") && !it.contains("[DONE]") }
            for (line in lines.reversed()) {
                val json = line.removePrefix("data: ")
                try {
                    val parsed = JSONObject(json)
                    val usage = extractUsage(providerId, parsed)
                    if (usage != null) return usage
                } catch (_: Exception) {
                    continue
                }
            }
            return null
        }

        // Non-streaming JSON
        return try {
            val parsed = JSONObject(body)
            extractUsage(providerId, parsed)
        } catch (_: Exception) {
            null
        }
    }

    private fun extractUsage(providerId: String, parsed: JSONObject): TokenUsage? {
        // Anthropic: { usage: { input_tokens, output_tokens } }
        if (providerId == "anthropic") {
            val usage = parsed.optJSONObject("usage") ?: return null
            val input = usage.optInt("input_tokens", -1)
            val output = usage.optInt("output_tokens", -1)
            if (input >= 0 && output >= 0) return sanitize(input, output)
        }

        // Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
        if (providerId == "gemini") {
            val meta = parsed.optJSONObject("usageMetadata") ?: return null
            val prompt = meta.optInt("promptTokenCount", -1)
            if (prompt < 0) return null
            val candidates = meta.optInt("candidatesTokenCount", 0)
            return sanitize(prompt, candidates)
        }

        // OpenAI-compatible: { usage: { prompt_tokens, completion_tokens } }
        val usage = parsed.optJSONObject("usage") ?: return null
        val prompt = usage.optInt("prompt_tokens", -1)
        val completion = usage.optInt("completion_tokens", -1)
        if (prompt >= 0 && completion >= 0) return sanitize(prompt, completion)

        return null
    }

    private fun sanitize(input: Int, output: Int): TokenUsage? {
        val i = maxOf(0, input)
        val o = maxOf(0, output)
        return TokenUsage(i, o)
    }
}
