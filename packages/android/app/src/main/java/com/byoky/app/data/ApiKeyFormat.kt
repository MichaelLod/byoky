package com.byoky.app.data

/**
 * What a stored key may look like: printable ASCII only. Every provider key
 * and setup token is, and the key travels in an HTTP header, where anything
 * else is invalid. A control or non-ASCII character (typically a zero-width
 * space picked up while copying) makes OkHttp reject the header with an
 * error that quotes the value, so such keys are refused when they are added
 * or imported. Pure, unit-tested.
 */
object ApiKeyFormat {
    const val INVALID_MESSAGE =
        "This key contains a character API keys never have, often an invisible one picked up while copying. Copy the key again from your provider and paste it here."

    /** The key with surrounding whitespace trimmed, or null if it isn't printable ASCII. */
    fun normalize(raw: String): String? {
        val trimmed = raw.trim()
        return if (isValid(trimmed)) trimmed else null
    }

    /** True when every character is printable ASCII (space to tilde). The empty key passes. */
    fun isValid(key: String): Boolean = key.all { it in ' '..'~' }
}
