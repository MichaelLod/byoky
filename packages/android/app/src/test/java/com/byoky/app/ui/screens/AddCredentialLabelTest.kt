package com.byoky.app.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The add-key sheet's label as the user switches providers. */
class AddCredentialLabelTest {

    @Test
    fun anAutoFilledLabelFollowsTheProvider() {
        // Tapped OpenAI first (label auto-filled), then Anthropic.
        assertEquals("Anthropic", autoFilledLabel("OpenAI", labelIsAuto = true, providerName = "Anthropic"))
    }

    @Test
    fun aTypedLabelStays() {
        assertNull(autoFilledLabel("Work key", labelIsAuto = false, providerName = "Anthropic"))
    }

    @Test
    fun anEmptyLabelIsFilledIn() {
        assertEquals("OpenAI", autoFilledLabel("", labelIsAuto = true, providerName = "OpenAI"))
        // Cleared by the user: filled in again on the next pick.
        assertEquals("OpenAI", autoFilledLabel("  ", labelIsAuto = false, providerName = "OpenAI"))
    }
}
