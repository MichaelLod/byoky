package com.byoky.app.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The Connected tab's Disconnect all prompt as apps' sessions end under it. */
class DisconnectAllPromptTest {

    @Test
    fun countsTheAppsLeft() {
        assertEquals("Disconnect 3 apps?", disconnectAllTitle(3))
        assertEquals("Disconnect 2 apps?", disconnectAllTitle(2))
        // One session ended while the prompt was open.
        assertEquals("Disconnect 1 app?", disconnectAllTitle(1))
    }

    @Test
    fun closesWhenNoAppIsLeft() {
        // Every session ended while the prompt was open: no "Disconnect 0 apps?".
        assertNull(disconnectAllTitle(0))
    }
}
