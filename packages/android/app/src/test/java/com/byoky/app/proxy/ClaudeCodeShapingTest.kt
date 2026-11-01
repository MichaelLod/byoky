package com.byoky.app.proxy

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Setup-token shaping must produce what the extension sends.
 *
 * `prepare` stands in for the bundled `prepareClaudeCodeBody`: the recorded
 * values are its real output (assets/mobile.js run in Node). `expected` is
 * the extension's result for the same input, computed with core's
 * `rewriteToolNamesForClaudeCode` + `injectClaudeCodeSystemPrompt(…,
 * { relocateExisting: toolNameMap non-empty })` from packages/core/dist.
 * Bodies are compared as JSON, since key order is not significant.
 */
class ClaudeCodeShapingTest {

    private val prefix = ClaudeCodeShaping.SYSTEM_PREFIX

    private data class Case(
        val input: String,
        val mobilePrepared: ClaudeCodeShaping.Shaped,
        val expected: ClaudeCodeShaping.Shaped,
    )

    private val stringSystem = Case(
        input = """{"model":"m","system":"Be terse.","messages":[{"role":"user","content":"hi"}]}""",
        mobilePrepared = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix","messages":[{"role":"user","content":"<system_context>\nBe terse.\n</system_context>\n\nhi"}]}""",
            emptyMap(),
        ),
        expected = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix\n\nBe terse.","messages":[{"role":"user","content":"hi"}]}""",
            emptyMap(),
        ),
    )

    private val claudeCodeTools = Case(
        input = """{"model":"m","system":"Sys","tools":[{"name":"Read","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}""",
        mobilePrepared = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix","tools":[{"name":"Read","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"<system_context>\nSys\n</system_context>\n\nhi"}]}""",
            emptyMap(),
        ),
        expected = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix\n\nSys","tools":[{"name":"Read","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}""",
            emptyMap(),
        ),
    )

    private val thirdPartyTools = Case(
        input = """{"model":"m","system":"Framework prompt","tools":[{"name":"read_file","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"hi"}]}""",
        mobilePrepared = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix","tools":[{"name":"ReadFile","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"<system_context>\nFramework prompt\n</system_context>\n\nhi"}]}""",
            mapOf("ReadFile" to "read_file"),
        ),
        expected = ClaudeCodeShaping.Shaped(
            """{"model":"m","system":"$prefix","tools":[{"name":"ReadFile","input_schema":{"type":"object"}}],"messages":[{"role":"user","content":"<system_context>\nFramework prompt\n</system_context>\n\nhi"}]}""",
            mapOf("ReadFile" to "read_file"),
        ),
    )

    private fun assertSameJson(expected: String, actual: String) {
        assertTrue("expected\n$expected\nactual\n$actual", JSONObject(expected).similar(JSONObject(actual)))
    }

    private fun check(case: Case) {
        val shaped = ClaudeCodeShaping.shape(case.input) { body ->
            assertEquals(case.input, body)
            case.mobilePrepared
        }
        assertSameJson(case.expected.body, shaped.body)
        assertEquals(case.expected.toolNameMap, shaped.toolNameMap)
    }

    @Test
    fun noToolRenameMeansPrefixNotRelocation() {
        // The bundled helper always relocates; the extension doesn't when no
        // tool names were rewritten. Shaping must follow the extension.
        check(stringSystem)
        check(claudeCodeTools)
    }

    @Test
    fun thirdPartyToolsGetRenamedAndSystemRelocated() {
        check(thirdPartyTools)
    }

    @Test
    fun withoutTheSandboxThePrefixIsStillApplied() {
        val shaped = ClaudeCodeShaping.shape(stringSystem.input, prepare = null)
        assertSameJson(stringSystem.expected.body, shaped.body)
        assertTrue(shaped.toolNameMap.isEmpty())

        val failing = ClaudeCodeShaping.shape(stringSystem.input) { throw IllegalStateException("sandbox died") }
        assertSameJson(stringSystem.expected.body, failing.body)
    }

    /**
     * packages/core/tests/vectors/claude-code-shaping.json, "body". The JVM
     * has no JS sandbox, so only the cases where no tool is renamed run here
     * (shape() then takes the native prefix path); the renamed ones come from
     * the bundled core and are covered by the iOS run of the same file.
     */
    @Test
    fun matchesTheSharedVectorsWithoutRenames() {
        val vectors = SharedVectors.load("claude-code-shaping.json").getJSONArray("body")
        var checked = 0
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            if (v.getJSONObject("toolNameMap").length() > 0) continue
            val shaped = ClaudeCodeShaping.shape(v.getString("body"), prepare = null)
            val expected = v.getString("expected")
            val name = v.getString("name")
            if (expected.trimStart().startsWith("{")) {
                assertTrue("$name\nexpected\n$expected\nactual\n${shaped.body}", JSONObject(expected).similar(JSONObject(shaped.body)))
            } else {
                assertEquals(name, expected, shaped.body)
            }
            assertTrue(name, shaped.toolNameMap.isEmpty())
            checked++
        }
        assertTrue("no shared vectors without renames", checked > 0)
    }

    @Test
    fun prefixHandlesEverySystemShapeLikeCore() {
        // Expected values from core injectClaudeCodeSystemPrompt(body).
        assertSameJson(
            """{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}],"system":"$prefix"}""",
            ClaudeCodeShaping.prependSystemPrefix("""{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}"""),
        )
        assertSameJson(
            """{"model":"m","system":[{"type":"text","text":"$prefix"},{"type":"text","text":"A"},{"type":"text","text":"B"}],"messages":[{"role":"user","content":"hi"}]}""",
            ClaudeCodeShaping.prependSystemPrefix("""{"model":"m","system":[{"type":"text","text":"A"},{"type":"text","text":"B"}],"messages":[{"role":"user","content":"hi"}]}"""),
        )
        assertSameJson(
            """{"system":"$prefix"}""",
            ClaudeCodeShaping.prependSystemPrefix("""{"system":""}"""),
        )
        assertEquals("not json", ClaudeCodeShaping.prependSystemPrefix("not json"))
        val objectSystem = """{"system":{"weird":true}}"""
        assertEquals(objectSystem, ClaudeCodeShaping.prependSystemPrefix(objectSystem))
    }
}
