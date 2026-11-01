package com.byoky.app.ui.screens

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The master-password rule behind Create Wallet (the extension's: core checkPasswordStrength, score ≥ 2). */
class OnboardingRulesTest {

    @Test
    fun rejectsPasswordsTheExtensionAndTheExportCheckReject() {
        // Accepted by the old onboarding rule (12+ chars, 2 character classes),
        // rejected by core: sequential pattern, score 0 / 1.
        assertFalse(canCreateWallet("password1234", "password1234"))
        assertFalse(canCreateWallet("Password1234", "Password1234"))
        // Too short or a common password.
        assertFalse(canCreateWallet("Short1!", "Short1!"))
        assertFalse(canCreateWallet("password123", "password123"))
    }

    @Test
    fun acceptsWhatCoreScoresFairOrBetter() {
        // Score 2 with a single character class: core and the extension accept it.
        assertTrue(canCreateWallet("correcthorsebattery", "correcthorsebattery"))
        assertTrue(canCreateWallet("Correct-Horse-42x", "Correct-Horse-42x"))
        // The password the Maestro onboarding flow types.
        assertTrue(canCreateWallet("TestPassword123!long", "TestPassword123!long"))
    }

    @Test
    fun requiresTheConfirmationToMatch() {
        assertFalse(canCreateWallet("Correct-Horse-42x", "Correct-Horse-43x"))
        assertFalse(canCreateWallet("Correct-Horse-42x", ""))
    }
}
