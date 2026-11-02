package com.byoky.app.ui.screens

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.byoky.app.ui.theme.ByokyTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

/**
 * The screen shown when the Keystore won't open the wallet: trying again is
 * one tap, starting fresh (which gives up the keys on the phone) never
 * happens without the confirmation.
 */
@RunWith(AndroidJUnit4::class)
class VaultUnavailableScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val tries = AtomicInteger()
    private val freshStarts = AtomicInteger()
    private val opened = AtomicInteger()

    private fun show(tryAgainOpens: Boolean, startFreshOpens: Boolean = true) {
        compose.setContent {
            ByokyTheme {
                VaultUnavailableScreen(
                    tryAgain = { tries.incrementAndGet(); tryAgainOpens },
                    startFresh = { freshStarts.incrementAndGet(); startFreshOpens },
                    onOpened = { opened.incrementAndGet() },
                )
            }
        }
    }

    @Test
    fun tryAgainThatStillFailsSaysSoAndOpensNothing() {
        show(tryAgainOpens = false)
        compose.onNodeWithText("Try again", ignoreCase = true).performClick()
        compose.waitUntil(5_000) { tries.get() == 1 }
        compose.onNodeWithText("Still can't open the wallet. Restart the phone and try again.").assertExists()
        assertEquals(0, opened.get())
        assertEquals(0, freshStarts.get())
    }

    @Test
    fun tryAgainThatWorksOpensTheWallet() {
        show(tryAgainOpens = true)
        compose.onNodeWithText("Try again", ignoreCase = true).performClick()
        compose.waitUntil(5_000) { opened.get() == 1 }
        assertEquals(0, freshStarts.get())
    }

    @Test
    fun startingFreshNeedsTheConfirmation() {
        show(tryAgainOpens = false)
        compose.onNodeWithContentDescription("Start a fresh wallet").performClick()
        compose.onNodeWithText("The keys on this phone will be lost", substring = true).assertExists()
        assertEquals(0, freshStarts.get())

        compose.onNodeWithContentDescription("Cancel").performClick()
        compose.waitForIdle()
        assertEquals(0, freshStarts.get())

        compose.onNodeWithContentDescription("Start a fresh wallet").performClick()
        compose.onNodeWithContentDescription("Start fresh").performClick()
        compose.waitUntil(5_000) { opened.get() == 1 }
        assertEquals(1, freshStarts.get())
        assertEquals(0, tries.get())
    }
}
