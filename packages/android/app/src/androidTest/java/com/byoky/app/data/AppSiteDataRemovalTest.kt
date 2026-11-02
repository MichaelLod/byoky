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
 * Removing an app from the list takes what it stored in the in-wallet
 * browser along (its login cookies and localStorage), but never another
 * app's. Kept apart from the reset test, whose wipe of all site data
 * finishes in the background.
 */
@RunWith(AndroidJUnit4::class)
class AppSiteDataRemovalTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context: Context = instrumentation.targetContext
    private val pages = BrowserPages(instrumentation)
    private lateinit var wallet: WalletStore

    @Before
    fun setup() {
        clearWalletState()
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword("AppSiteDataRemovalTest!long-pass") }
    }

    @After
    fun tearDown() {
        wallet.lock()
        clearWalletState()
    }

    @Test
    fun removingAnAppDeletesItsDataButNotAnotherApps() {
        val removed = (wallet.addAppByUrl("https://removed.example.com/chat") as WalletStore.AddAppResult.Added).app
        wallet.addAppByUrl("https://kept.example.org/")
        pages.store("https://removed.example.com", "removed app data")
        pages.store("https://kept.example.org", "kept app data")

        wallet.uninstallApp(removed.id)

        assertEquals(BrowserPages.NOTHING, pages.readUntil("https://removed.example.com", BrowserPages.NOTHING))
        assertEquals("\"kept app data | sid=owner\"", pages.read("https://kept.example.org"))
    }

    @Test
    fun removingOneOfTwoAppsOnAnOriginKeepsItsData() {
        val first = (wallet.addAppByUrl("https://shared.example.com/a") as WalletStore.AddAppResult.Added).app
        wallet.addAppByUrl("https://shared.example.com/b")
        pages.store("https://shared.example.com", "shared data")

        wallet.uninstallApp(first.id)
        instrumentation.runOnMainSync {}

        assertEquals("\"shared data | sid=owner\"", pages.read("https://shared.example.com"))
    }

    private fun clearWalletState() {
        context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE).edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }
}
