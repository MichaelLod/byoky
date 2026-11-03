package com.byoky.app.ui.screens

import android.content.Context
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.VaultPrefs
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.ByokyTheme
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

/**
 * The Wallet tab on a phone in landscape. The add button sits in a rail at
 * the side, clear of every card's Rename and Remove buttons, and a whole
 * card fits between the header and the bottom of the screen. Before, the
 * fixed header and the bottom bar left the list about 80 dp, and the
 * floating add button covered the cards' Remove buttons.
 */
@RunWith(AndroidJUnit4::class)
class MainScreenLandscapeTest {
    private val compose = createComposeRule()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(DisplaySetup(fontScale = 1f, landscape = true)).around(compose)

    private lateinit var context: Context
    private lateinit var wallet: WalletStore

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearWalletState()
        wallet = WalletStore(context)
        runBlocking {
            wallet.createPassword("MainScreenLandscapeTest!long")
            wallet.addCredential("anthropic", "Work", "sk-ant-api03-not-a-real-key-0000")
            wallet.addCredential("openai", "Personal", "sk-proj-not-a-real-key-0000")
        }
    }

    @After
    fun tearDown() {
        try { wallet.lock() } catch (_: Throwable) {}
        clearWalletState()
    }

    @Test
    fun addButtonStaysClearOfTheCards() {
        compose.setContent { ByokyTheme { AppNavigation(wallet) } }

        val add = compose.onNodeWithContentDescription("Open add menu").fetchSemanticsNode().boundsInRoot
        val buttons = compose.onAllNodes(hasContentDescription("Remove") or hasContentDescription("Rename"))
            .fetchSemanticsNodes()
        assertTrue("no card buttons on screen", buttons.isNotEmpty())
        for (button in buttons) {
            assertFalse("the add button $add covers ${button.boundsInRoot}", button.boundsInRoot.overlaps(add))
        }
    }

    @Test
    fun aWholeCardFits() {
        compose.setContent { ByokyTheme { AppNavigation(wallet) } }

        // The first card (one clickable node, found by its last line) is
        // on screen in full, not cut off by the edge of the list.
        val card = compose.onAllNodesWithText("output")[0].fetchSemanticsNode()
        assertTrue("the first card is off screen", card.boundsInRoot.height > 0f)
        assertEquals("visible part of the first card", card.size.height.toFloat(), card.boundsInRoot.height, 0.5f)
    }

    private fun clearWalletState() {
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }
}
