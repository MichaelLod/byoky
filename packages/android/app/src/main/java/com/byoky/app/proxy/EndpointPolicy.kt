package com.byoky.app.proxy

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * Which provider endpoints an app may call through the wallet: GET only for
 * model listing, POST only to inference endpoints, nothing else (no DELETE,
 * no files, batches, fine-tunes or account management, which would also let
 * one app read what another stored under the same key). Only the path is
 * checked; the host is [UpstreamPolicy]'s job.
 *
 * Mirrors `isAllowedProxyRequest` and `shouldEstimateUsage` in
 * packages/core/src/proxy-utils.ts; the extension, bridge and iOS apply the
 * same rules. Keep them identical. Path segments are percent-decoded first
 * (servers decode `/v1/%74hreads` to `/v1/threads`); a segment that doesn't
 * decode, or decodes to something holding a separator, is refused.
 * Pure, unit-tested.
 */
object EndpointPolicy {

    const val ERROR_CODE = "ENDPOINT_NOT_ALLOWED"
    const val ERROR_MESSAGE = "Apps can only call inference and model-listing endpoints through Byoky"
    const val ERROR_STATUS = 403

    private val BLOCKED_SEGMENTS = setOf(
        "files", "upload", "uploads", "batches", "batch", "fine_tuning", "fine-tunes", "fine_tunes",
        "assistants", "threads", "vector_stores", "organization", "organizations", "admin", "projects",
        "evals", "containers", "cachedcontents", "realtime", "keys", "api_keys", "invites", "users", "webhooks",
    )

    /** Gemini's `models/{model}:{action}` inference actions (case-sensitive). */
    private val GEMINI_POST_ACTIONS = setOf(
        "generateContent", "streamGenerateContent", "countTokens", "embedContent", "batchEmbedContents",
    )

    /** Trailing path segments of the inference endpoints, across provider dialects. */
    private val POST_SUFFIXES = listOf(
        "chat/completions", "completions", "responses", "responses/input_tokens", "embeddings", "moderations",
        "audio/speech", "audio/transcriptions", "audio/translations", "images/generations", "images/edits",
        "images/variations", "messages", "messages/count_tokens", "complete", "chat", "embed", "rerank",
        "generate", "api/show",
    ).map { it.split('/') }

    /** Text-generation endpoints: the only ones whose missing usage is estimated. */
    private val GENERATION_SUFFIXES = listOf(
        "chat/completions", "completions", "responses", "messages", "chat", "complete", "generate",
    ).map { it.split('/') }

    private val GENERATE_CONTENT = Regex(":(stream)?[Gg]enerateContent$")

    /** Local servers bill nothing. */
    private val LOCAL_PROVIDERS = setOf("ollama", "lm_studio")

    /**
     * The check for a URL as the app (or the routing rewrite) wrote it.
     * Malformed escapes are refused here: OkHttp would quietly re-encode
     * `%zz` as `%25zz` and the parsed form could no longer tell.
     */
    fun isAllowed(method: String, url: String): Boolean {
        val beforeQuery = url.substringBefore('?').substringBefore('#')
        if (hasMalformedEscape(beforeQuery)) return false
        val parsed = url.toHttpUrlOrNull() ?: return false
        return isAllowed(method, parsed)
    }

    fun isAllowed(method: String, url: HttpUrl): Boolean {
        val raw = decodedSegments(url) ?: return false
        if (raw.any { s -> s == "." || s == ".." || s.any { it == '/' || it == '\\' || it == ';' } }) return false
        val lower = raw.map { it.lowercase() }
        if (lower.any { it in BLOCKED_SEGMENTS }) return false

        return when (method.uppercase()) {
            "GET" -> {
                val n = lower.size
                (n >= 1 && lower[n - 1] == "models") ||
                    (n >= 2 && lower[n - 2] == "models" && ':' !in lower[n - 1]) ||
                    endsWith(lower, listOf("api", "tags")) ||
                    endsWith(lower, listOf("api", "version"))
            }
            "POST" -> {
                val last = raw.lastOrNull() ?: ""
                val colon = last.lastIndexOf(':')
                (colon >= 0 && last.substring(colon + 1) in GEMINI_POST_ACTIONS) ||
                    POST_SUFFIXES.any { endsWith(lower, it) }
            }
            else -> false
        }
    }

    /**
     * Whether a successful response with no readable usage is charged an
     * estimate: only text generation is, only when the reply is JSON or SSE,
     * and never for local servers. Embeddings, images, audio and token
     * counts would be wildly overcharged by a size-based guess.
     */
    fun shouldEstimateUsage(upstreamProviderId: String, appUrl: HttpUrl, contentType: String): Boolean {
        if (upstreamProviderId in LOCAL_PROVIDERS) return false
        val type = contentType.lowercase()
        if ("json" !in type && "text/event-stream" !in type) return false
        val path = appUrl.encodedPath
        if (GENERATE_CONTENT.containsMatchIn(path.substringAfterLast('/'))) return true
        val segments = path.lowercase().split('/').filter { it.isNotEmpty() }
        return GENERATION_SUFFIXES.any { endsWith(segments, it) }
    }

    /** Non-empty path segments, percent-decoded as strict UTF-8; null if one doesn't decode. */
    private fun decodedSegments(url: HttpUrl): List<String>? =
        url.encodedPathSegments.filter { it.isNotEmpty() }.map { decode(it) ?: return null }

    private fun decode(segment: String): String? {
        if ('%' !in segment) return segment
        val bytes = ByteArrayOutputStream(segment.length)
        var i = 0
        while (i < segment.length) {
            val c = segment[i]
            if (c == '%') {
                if (i + 2 >= segment.length) return null
                val hi = Character.digit(segment[i + 1], 16)
                val lo = Character.digit(segment[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                bytes.write(c.toString().toByteArray(Charsets.UTF_8))
                i++
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString()
        } catch (_: CharacterCodingException) {
            null
        }
    }

    private fun hasMalformedEscape(text: String): Boolean {
        var i = text.indexOf('%')
        while (i >= 0) {
            if (i + 2 >= text.length) return true
            if (Character.digit(text[i + 1], 16) < 0 || Character.digit(text[i + 2], 16) < 0) return true
            i = text.indexOf('%', i + 3)
        }
        return false
    }

    /** Whole trailing segments: `/foo/chat` ends with `chat`, `/foochat` doesn't. */
    private fun endsWith(segments: List<String>, suffix: List<String>): Boolean {
        if (suffix.size > segments.size) return false
        val offset = segments.size - suffix.size
        return suffix.indices.all { segments[offset + it] == suffix[it] }
    }
}
