package com.byoky.app.data

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What apps store in the in-wallet browser (logins, localStorage) goes with
 * a wallet reset, so whoever resets a locked phone with "Forgot password?"
 * can't re-add an app and land in the owner's account.
 */
@RunWith(AndroidJUnit4::class)
class BrowserDataResetTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val pages = BrowserPages(instrumentation)

    @Before
    fun setup() = clearWalletState()

    @After
    fun tearDown() = clearWalletState()

    @Test
    fun aResetDeletesAppLoginsAndStorage() {
        val wallet = WalletStore(context)
        runBlocking { wallet.createPassword("BrowserDataResetTest!long-pass") }
        wallet.addAppByUrl("https://reset.example.com/")
        pages.store("https://reset.example.com", "owner prompt")
        assertEquals("\"owner prompt | sid=owner\"", pages.read("https://reset.example.com"))

        wallet.lock()
        wallet.resetWallet() // what "Forgot password?" does, with no password

        runBlocking { wallet.createPassword("SomeoneElse!long-password") }
        wallet.addAppByUrl("https://reset.example.com/")
        assertEquals(BrowserPages.NOTHING, pages.readUntil("https://reset.example.com", BrowserPages.NOTHING))
    }

    private fun clearWalletState() {
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }
}
