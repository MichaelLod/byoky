package com.byoky.app.ui.screens

import com.byoky.app.data.AppOpenGate
import com.byoky.app.data.InstalledApp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which in-wallet app unlocking goes back to after an auto-lock. */
class AppResumeTest {

    private val chat = InstalledApp(id = "chat", name = "Chat", url = "https://chat.byoky.com/")
    private val demo = InstalledApp(id = "demo", name = "Demo", url = "https://byoky.com/demo", enabled = false)
    private val apps = listOf(chat, demo)
    private val open: (InstalledApp) -> AppOpenGate.Decision = { AppOpenGate.decide(it, emptySet()) }

    @Test
    fun reopensTheAppThatWasOnScreen() {
        assertEquals(chat, appToResume("chat", apps, open))
    }

    @Test
    fun staysOnTheWalletWhenNoAppWasOpen() {
        assertNull(appToResume(null, apps, open))
    }

    @Test
    fun skipsAnAppThatWasRemovedOrDisabled() {
        assertNull(appToResume("gone", apps, open))
        assertNull(appToResume("demo", apps, open))
    }

    @Test
    fun leavesARevokedOriginToTheReconnectPrompt() {
        val revoked: (InstalledApp) -> AppOpenGate.Decision = { AppOpenGate.decide(it, setOf("https://chat.byoky.com")) }
        assertNull(appToResume("chat", apps, revoked))
    }
}
