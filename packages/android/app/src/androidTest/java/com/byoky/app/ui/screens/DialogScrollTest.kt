package com.byoky.app.ui.screens

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.ByokyTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith

/**
 * A dialog that is short of room scrolls its body (RetroDialog), so the last
 * field of a form keeps its full height and can be scrolled to. Before,
 * AlertDialog squashed it into a sliver at the largest font size and left it
 * out in landscape: Export backup had no Confirm password field, and Token
 * limit lost its last providers.
 */
abstract class DialogScrollTest(fontScale: Float, landscape: Boolean) {
    private val compose = createComposeRule()

    // The display is set up before the test activity starts, which a
    // rotation or font change would otherwise recreate mid-test.
    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(DisplaySetup(fontScale, landscape)).around(compose)

    @Test
    fun exportDialogKeepsConfirmPasswordReachable() {
        val wallet = WalletStore(InstrumentationRegistry.getInstrumentation().targetContext)
        compose.setContent {
            ByokyTheme { ExportPasswordDialog(wallet, onDismiss = {}, onConfirm = {}) }
        }
        assertReachableAtFullHeight(reference = "Wallet password", last = "Confirm password")
    }

    @Test
    fun tokenLimitDialogKeepsEveryProviderReachable() {
        // Every provider, as an app that names none gets: Anthropic first
        // and OpenAI last, two short names whose captions fit on one line.
        val ids = Provider.all.map { it.id }
        val providers = listOf("anthropic") + (ids - "anthropic" - "openai") + "openai"
        compose.setContent {
            ByokyTheme {
                AllowanceDialog(
                    origin = "https://app.example.com",
                    providers = providers,
                    allowance = null,
                    onSave = {},
                    onRemove = {},
                    onDismiss = {},
                )
            }
        }
        assertReachableAtFullHeight(reference = "Anthropic", last = "OpenAI")
    }

    /** [last] is as tall as [reference], a field of the same kind, and can be scrolled into view. */
    private fun assertReachableAtFullHeight(reference: String, last: String) {
        val expected = compose.onNode(field(reference)).fetchSemanticsNode().size.height
        val lastField = compose.onNode(field(last))
        assertTrue("$reference has no height", expected > 0)
        assertEquals("$last is squashed", expected, lastField.fetchSemanticsNode().size.height)
        lastField.performScrollTo().assertIsDisplayed()
    }

    private fun field(caption: String): SemanticsMatcher = hasSetTextAction() and hasContentDescription(caption)
}

/** The largest font size, in portrait. */
@RunWith(AndroidJUnit4::class)
class DialogScrollLargestFontTest : DialogScrollTest(fontScale = 2f, landscape = false)

/** A phone in landscape, at the default font size. */
@RunWith(AndroidJUnit4::class)
class DialogScrollLandscapeTest : DialogScrollTest(fontScale = 1f, landscape = true)
