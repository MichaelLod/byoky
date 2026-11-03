package com.byoky.app.ui.components

import android.content.Context
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.VaultPrefs
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.screens.UnlockScreen
import com.byoky.app.ui.theme.ByokyTheme
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A password shown in clear text keeps the window out of screenshots,
 * recordings and recents (FLAG_SECURE); the rest of the time the screen can
 * be captured, as store screenshots and users do.
 */
@RunWith(AndroidJUnit4::class)
class SecureWindowTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun isSecure(): Boolean = compose.runOnIdle {
        compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    }

    @After
    fun tearDown() {
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }

    @Test
    fun aRevealedPasswordOnTheUnlockScreenIsKeptOutOfScreenshots() {
        tearDown()
        val wallet = WalletStore(context)
        runBlocking { wallet.createPassword("SecureWindowTest!long-pass") }
        wallet.lock()
        compose.setContent { ByokyTheme { UnlockScreen(wallet) } }

        assertFalse("the masked unlock screen can be captured", isSecure())

        compose.onNodeWithContentDescription("Show password").performClick()
        assertTrue(isSecure())

        compose.onNodeWithContentDescription("Hide password").performClick()
        assertFalse(isSecure())

        // Leaving the app hides the password again, and the flag goes with it.
        compose.onNodeWithContentDescription("Show password").performClick()
        assertTrue(isSecure())
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.onNodeWithContentDescription("Show password").assertExists()
        assertFalse(isSecure())
    }

    @Test
    fun theFlagStaysWhileAnyScreenStillWantsIt() {
        var first by mutableStateOf(true)
        var second by mutableStateOf(true)
        compose.setContent {
            SecureWindow(enabled = first)
            SecureWindow(enabled = second)
        }
        assertTrue(isSecure())

        first = false
        assertTrue("one screen dropping it doesn't clear it for the other", isSecure())

        second = false
        assertFalse(isSecure())
    }
}
