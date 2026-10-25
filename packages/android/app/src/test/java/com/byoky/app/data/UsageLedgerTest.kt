package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageLedgerTest {

    private val origin = "https://app.example"

    private fun UsageLedger.allowed(allowance: TokenAllowance?, providerId: String = "anthropic", estimate: Long = 0) =
        admit(allowance, origin, providerId) { estimate }

    private fun UsageLedger.spend(providerId: String, tokens: Long) {
        val admission = allowed(null, providerId) as UsageLedger.Admission.Allowed
        settle(admission.reservation, UsageLedger.Usage(1, tokens, 0))
    }

    @Test
    fun cheapRequestsCantPushExpensiveOnesOutOfTheCount() {
        val ledger = UsageLedger()
        val allowance = TokenAllowance(origin, totalLimit = 100_000)
        ledger.spend("anthropic", 99_000)
        // Far more cheap requests than the 500-entry display log holds.
        repeat(2_000) { ledger.spend("anthropic", 1) }
        assertTrue(ledger.allowed(allowance) is UsageLedger.Admission.Denied)
        assertEquals(2_001L, ledger.total(origin).requests)
        assertEquals(101_000L, ledger.total(origin).tokens)
    }

    @Test
    fun parallelRequestsCantAllStartAgainstTheSameBudget() {
        val ledger = UsageLedger()
        val allowance = TokenAllowance(origin, totalLimit = 10_000)
        val first = ledger.allowed(allowance, estimate = 6_000)
        val second = ledger.allowed(allowance, estimate = 6_000)
        val third = ledger.allowed(allowance, estimate = 6_000)
        assertTrue(first is UsageLedger.Admission.Allowed)
        assertTrue(second is UsageLedger.Admission.Allowed)
        assertTrue(third is UsageLedger.Admission.Denied)

        // Settling releases the hold and books what was really used.
        ledger.settle((first as UsageLedger.Admission.Allowed).reservation, UsageLedger.Usage(1, 100, 100))
        ledger.settle((second as UsageLedger.Admission.Allowed).reservation, UsageLedger.Usage(1, 100, 100))
        assertTrue(ledger.allowed(allowance) is UsageLedger.Admission.Allowed)
        assertEquals(400L, ledger.total(origin).tokens)
    }

    @Test
    fun aFailedRequestOnlyReleasesItsHold() {
        val ledger = UsageLedger()
        val allowance = TokenAllowance(origin, totalLimit = 1_000)
        val held = ledger.allowed(allowance, estimate = 5_000) as UsageLedger.Admission.Allowed
        assertTrue(ledger.allowed(allowance) is UsageLedger.Admission.Denied)
        ledger.settle(held.reservation, null)
        assertTrue(ledger.allowed(allowance) is UsageLedger.Admission.Allowed)
        assertEquals(UsageLedger.Usage(), ledger.total(origin))
    }

    @Test
    fun providerLimitsUseTheProviderTheAppNamed() {
        val ledger = UsageLedger()
        val allowance = TokenAllowance(origin, providerLimits = mapOf("anthropic" to 50))
        ledger.spend("anthropic", 60)
        assertTrue(ledger.allowed(allowance, "anthropic") is UsageLedger.Admission.Denied)
        assertTrue(ledger.allowed(allowance, "openai") is UsageLedger.Admission.Allowed)
    }

    @Test
    fun noAllowanceMeansNoEstimateAndNoLimit() {
        val ledger = UsageLedger()
        val admission = ledger.admit(null, origin, "openai") { error("not needed without an allowance") }
        assertTrue(admission is UsageLedger.Admission.Allowed)
    }

    @Test
    fun totalsSurviveAJsonRoundTrip() {
        val ledger = UsageLedger()
        ledger.spend("anthropic", 10)
        ledger.spend("openai", 20)
        val restored = UsageLedger.fromJson(ledger.toJson())
        assertEquals(ledger.byProvider(origin), restored.byProvider(origin))
        assertEquals(UsageLedger.Usage(), UsageLedger.fromJson("not json").total(origin))
    }

    @Test
    fun startsFromTheLogOnInstallsThatPredateIt() {
        val log = listOf(
            RequestLog(appOrigin = origin, providerId = "anthropic", method = "POST", url = "u", statusCode = 200, inputTokens = 5, outputTokens = 6),
            RequestLog(appOrigin = origin, providerId = "anthropic", method = "POST", url = "u", statusCode = 500, inputTokens = 100, outputTokens = 100),
        )
        assertEquals(UsageLedger.Usage(1, 5, 6), UsageLedger.fromLog(log).total(origin))
    }

    @Test
    fun estimateIsThePromptPlusTheLargestOutputLimit() {
        val body = "{\"max_tokens\":1000,\"max_completion_tokens\":3000,\"messages\":[]}".toByteArray()
        assertEquals((body.size + 3L) / 4 + 3000, UsageLedger.estimate(body))
        val gemini = "{\"generationConfig\":{\"maxOutputTokens\":50}}".toByteArray()
        assertEquals((gemini.size + 3L) / 4 + 50, UsageLedger.estimate(gemini))
        // No limit named: the prompt only. No body (GET) or a binary one: nothing.
        val plain = "{\"messages\":[]}".toByteArray()
        assertEquals((plain.size + 3L) / 4, UsageLedger.estimate(plain))
        assertEquals(0L, UsageLedger.estimate(null))
        assertEquals(0L, UsageLedger.estimate("{\"max_tokens\":9}".toByteArray(), binaryBody = true))
    }

    @Test
    fun smallAllowancesArentRefusedByAHoldForAGet() {
        val ledger = UsageLedger()
        val allowance = TokenAllowance(origin, totalLimit = 100)
        val list = ledger.admit(allowance, origin, "openai") { UsageLedger.estimate(null) }
        assertTrue(list is UsageLedger.Admission.Allowed)
        assertTrue(ledger.admit(allowance, origin, "openai") { 0 } is UsageLedger.Admission.Allowed)
    }

    @Test
    fun requestsAdmittedBeforeAResetDontWriteTheOldTotalsBack() {
        val ledger = UsageLedger()
        val inFlight = ledger.allowed(null) as UsageLedger.Admission.Allowed
        ledger.clear()
        assertFalse(ledger.settle(inFlight.reservation, UsageLedger.Usage(1, 500, 500)))
        assertEquals(UsageLedger.Usage(), ledger.total(origin))
    }
}
