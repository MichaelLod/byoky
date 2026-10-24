package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parity with packages/core/src/password-strength.ts. The expected rows were
 * produced by running core's real `checkPasswordStrength` (from
 * packages/core/dist) in Node on the same inputs.
 */
class PasswordStrengthTest {

    private data class Row(val password: String, val score: Int, val label: String, val feedback: List<String>)

    private val coreResults = listOf(
        Row("Short1!", 0, "Too weak", listOf("Use at least 12 characters")),
        Row("Password123", 0, "Too weak", listOf("Use at least 12 characters")),
        Row("QWERTY1234", 0, "Too weak", listOf("Use at least 12 characters")),
        Row("abcdefghijkl", 0, "Too weak", listOf("Mix uppercase, lowercase, numbers, and symbols", "Avoid sequential patterns")),
        Row("aaaaBBBB1111", 1, "Weak", listOf("Avoid repeated characters")),
        Row("Password1234", 1, "Weak", listOf("Avoid sequential patterns")),
        Row("Tr0ub4dor&3xyq", 3, "Strong", emptyList()),
        Row("Fixture-Pässwort-2026!", 4, "Very strong", emptyList()),
        Row("correcthorsebattery", 2, "Fair", listOf("Mix uppercase, lowercase, numbers, and symbols")),
        Row("Round-Trip-Passw0rd!", 4, "Very strong", emptyList()),
        Row("password1234", 0, "Too weak", listOf("Avoid sequential patterns")),
        Row("qwertyuiopas", 1, "Weak", listOf("Mix uppercase, lowercase, numbers, and symbols")),
        Row("ABCDEFGHIJKLMNOP", 1, "Weak", listOf("Mix uppercase, lowercase, numbers, and symbols", "Avoid sequential patterns")),
        Row("zzzzzzzzzzzzzzzz9", 1, "Weak", listOf("Avoid repeated characters")),
        Row("P@ssw0rd!Long#2026", 4, "Very strong", emptyList()),
    )

    @Test
    fun matchesCoreOutputExactly() {
        for (row in coreResults) {
            val r = PasswordStrength.check(row.password)
            assertEquals(row.password, Row(row.password, row.score, row.label, row.feedback), Row(row.password, r.score, r.label, r.feedback))
        }
    }

    @Test
    fun exportRuleIsTwelveCharactersAndScoreTwo() {
        assertFalse(PasswordStrength.isAcceptableForExport("aaaaBBBB1111"))
        assertFalse(PasswordStrength.isAcceptableForExport("Password1234"))
        // Score 2 ("Fair") is enough for the extension, so it is here too.
        assertTrue(PasswordStrength.isAcceptableForExport("correcthorsebattery"))
        assertTrue(PasswordStrength.isAcceptableForExport("Round-Trip-Passw0rd!"))
    }
}
