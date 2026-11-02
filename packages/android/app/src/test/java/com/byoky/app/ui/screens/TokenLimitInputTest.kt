package com.byoky.app.ui.screens

import com.byoky.app.data.TokenAllowance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The Token Limit dialog's fields (F015). They used String.toIntOrNull, so a
 * limit typed with a separator ("100,000", "1.000.000") or above Int.MAX_VALUE
 * saved as no limit, and 0 too: the app ran uncapped without a word.
 */
class TokenLimitInputTest {

    @Test
    fun fieldsKeepOnlyDigits() {
        assertEquals("100000", tokenLimitDigits("100,000"))
        assertEquals("1000000", tokenLimitDigits("1.000.000"))
        assertEquals("50000", tokenLimitDigits("50 000"))
        assertEquals("5", tokenLimitDigits("-5"))
        assertEquals("", tokenLimitDigits("abc"))
    }

    @Test
    fun readsTheDigitsAsTyped() {
        assertEquals(100_000, parseTokenLimit("100,000"))
        assertEquals(1_000_000, parseTokenLimit("1.000.000"))
        assertEquals(2_500, parseTokenLimit("2500"))
        assertEquals(7, parseTokenLimit("007"))
    }

    @Test
    fun zeroBlocksAndEmptyIsNoLimit() {
        assertEquals(0, parseTokenLimit("0"))
        assertEquals(0, parseTokenLimit("000"))
        assertNull(parseTokenLimit(""))
        assertNull(parseTokenLimit("abc"))
    }

    @Test
    fun capsALimitPastIntMaxInsteadOfDroppingIt() {
        assertEquals(Int.MAX_VALUE, parseTokenLimit("3000000000"))
        assertEquals(Int.MAX_VALUE, parseTokenLimit("2147483648"))
        assertEquals(Int.MAX_VALUE, parseTokenLimit("99999999999999999999999"))
        assertEquals(2_147_483_647, parseTokenLimit("2147483647"))
    }

    @Test
    fun buildsTheAllowanceFromTheFields() {
        assertEquals(
            TokenAllowance(origin = "https://app.example", totalLimit = 100_000, providerLimits = mapOf("openai" to 0)),
            allowanceFromFields("https://app.example", "100,000", mapOf("openai" to "0", "anthropic" to "")),
        )
        assertEquals(
            TokenAllowance(origin = "https://app.example", totalLimit = null, providerLimits = mapOf("anthropic" to 1_000)),
            allowanceFromFields("https://app.example", "", mapOf("anthropic" to "1.000")),
        )
    }

    @Test
    fun everyFieldEmptyIsNoAllowance() {
        assertNull(allowanceFromFields("https://app.example", "", mapOf("openai" to "", "anthropic" to "")))
        assertNull(allowanceFromFields("https://app.example", "", emptyMap()))
    }
}
