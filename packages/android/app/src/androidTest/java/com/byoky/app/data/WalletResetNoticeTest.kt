package com.byoky.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A wallet reset starts the user over on purpose: the one-time notices about
 * how this wallet came to be (an unreadable copied vault set aside, retired
 * features) no longer apply, in this session or the next.
 */
@RunWith(AndroidJUnit4::class)
class WalletResetNoticeTest {
    private lateinit var context: Context

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearWalletState()
    }

    @After
    fun tearDown() {
        clearWalletState()
    }

    @Test
    fun resetHidesTheUnreadableVaultNotice() {
        // As VaultPrefs leaves things after setting an unreadable vault aside.
        plainState().edit().putBoolean(VaultPrefs.RESET_NOTICE_FLAG, true).commit()
        val wallet = WalletStore(context)
        assertTrue(wallet.unreadableVaultNotice.value)
        runBlocking { wallet.createPassword("WalletResetNoticeTest!long") }

        wallet.resetWallet()

        assertFalse(wallet.unreadableVaultNotice.value)
        assertFalse(plainState().getBoolean(VaultPrefs.RESET_NOTICE_FLAG, false))
    }

    private fun plainState(): SharedPreferences =
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE)

    private fun clearWalletState() {
        plainState().edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }
}
