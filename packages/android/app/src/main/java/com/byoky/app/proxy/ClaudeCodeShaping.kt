package com.byoky.app.proxy

import org.json.JSONArray
import org.json.JSONObject

/**
 * Request shaping for Anthropic setup tokens (OAuth). Anthropic only accepts
 * these tokens for Claude-Code-shaped requests, judged partly by tool names
 * and the system prompt. Mirrors the extension (background.ts, OAuth branch):
 *
 *   const { body, toolNameMap } = rewriteToolNamesForClaudeCode(body)
 *   injectClaudeCodeSystemPrompt(body, { relocateExisting: toolNameMap is non-empty })
 *
 * The tool-name rewrite and the relocating injection come from the bundled
 * core (`prepareClaudeCodeBody` in assets/mobile.js), which always relocates.
 * The extension only relocates for third-party frameworks (when tool names
 * were rewritten), so when the map comes back empty this falls back to
 * [prependSystemPrefix] on the untouched body, as the extension does.
 *
 * Applied after cross-family translation too: by then the body is in
 * Anthropic shape. On the response, tool aliases are reversed with the
 * returned map before any translation back to the app's dialect.
 */
object ClaudeCodeShaping {
    const val SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."

    data class Shaped(val body: String, val toolNameMap: Map<String, String>)

    /**
     * @param prepare core's `prepareClaudeCodeBody` (tool rename + relocating
     *   inject), or null when the JS sandbox is unavailable.
     */
    fun shape(body: String, prepare: ((String) -> Shaped)?): Shaped {
        val prepared = prepare?.let { fn -> try { fn(body) } catch (_: Throwable) { null } }
        if (prepared != null && prepared.toolNameMap.isNotEmpty()) return prepared
        return Shaped(prependSystemPrefix(body), emptyMap())
    }

    /**
     * Port of core `injectClaudeCodeSystemPrompt(body)` without relocation:
     * missing/empty system → the prefix; string → prefix + blank line +
     * system; text-block array → a prefix block first. Unparseable bodies and
     * other system shapes pass through unchanged.
     */
    fun prependSystemPrefix(body: String): String {
        return try {
            val parsed = JSONObject(body)
            val system = parsed.opt("system")
            when {
                isFalsy(system) -> parsed.put("system", SYSTEM_PREFIX)
                system is String -> parsed.put("system", "$SYSTEM_PREFIX\n\n$system")
                system is JSONArray -> {
                    val blocks = JSONArray().put(JSONObject().put("type", "text").put("text", SYSTEM_PREFIX))
                    for (i in 0 until system.length()) blocks.put(system.get(i))
                    parsed.put("system", blocks)
                }
                else -> return body
            }
            parsed.toString()
        } catch (_: Exception) {
            body
        }
    }

    /** JavaScript `!value` for JSON values. */
    private fun isFalsy(value: Any?): Boolean = when (value) {
        null, JSONObject.NULL -> true
        is String -> value.isEmpty()
        is Boolean -> !value
        is Number -> value.toDouble() == 0.0 || value.toDouble().isNaN()
        else -> false
    }
}
