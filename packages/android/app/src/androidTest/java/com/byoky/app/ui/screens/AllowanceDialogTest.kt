package com.byoky.app.ui.screens

import android.content.Context
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.byoky.app.data.TokenAllowance
import com.byoky.app.data.VaultPrefs
import com.byoky.app.data.WalletStore
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The Token Limit dialog end to end (F015): a total typed as Gboard's number
 * pad allows ("100,000") or past Int.MAX_VALUE used to be stored as no limit.
 */
@RunWith(AndroidJUnit4::class)
class AllowanceDialogTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var context: Context
    private lateinit var wallet: WalletStore

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clear()
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword("AllowanceDialogTest!long-pass") }
        wallet.upsertSession("https://app.example", listOf("anthropic"))
    }

    @After
    fun tearDown() {
        try { wallet.lock() } catch (_: Throwable) {}
        clear()
    }

    private fun clear() {
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }

    /** Types `input` into the total field of a fresh dialog and saves. */
    private fun saveTotal(input: String): TokenAllowance? {
        compose.setContent { AppsScreen(wallet) }
        compose.onNodeWithContentDescription("Set limit").performClick()
        compose.waitForIdle()
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput(input)
        compose.onNodeWithText("Save", substring = true, ignoreCase = true).performClick()
        compose.waitForIdle()
        return wallet.tokenAllowances.value.firstOrNull()
    }

    @Test
    fun aThousandsSeparatorIsDroppedNotTheLimit() {
        assertEquals(100_000, saveTotal("100,000")?.totalLimit)
    }

    @Test
    fun aLimitPastIntMaxIsCappedNotDropped() {
        assertEquals(Int.MAX_VALUE, saveTotal("3000000000")?.totalLimit)
    }

    @Test
    fun zeroBlocksTheApp() {
        assertEquals(0, saveTotal("0")?.totalLimit)
    }

    @Test
    fun savingNothingStoresNoAllowance() {
        assertNull(saveTotal("abc"))
    }
}
