package com.byoky.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.security.crypto.MasterKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator

/**
 * A Keystore master key that exists but can't be used (as after an OS update
 * invalidates key blobs) leaves the wallet unavailable instead of crashing
 * the app at launch, and nothing is wiped until the user starts fresh.
 */
@RunWith(AndroidJUnit4::class)
class VaultKeystoreFaultTest {
    private lateinit var context: Context
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

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
    fun anUnusableMasterKeyLeavesTheWalletUnavailableAndUntouched() {
        val wallet = WalletStore(context)
        runBlocking {
            wallet.createPassword("VaultKeystoreFaultTest!long-pass")
            wallet.addCredential("openai", "Work", "sk-vault-keystore-fault-test")
        }
        wallet.lock()
        Thread.sleep(500) // EncryptedSharedPreferences writes with apply()
        replaceMasterKeyWithAnEncryptOnlyKey()

        val opening = VaultPrefs.attempt { WalletStore(context) }

        assertTrue("a Keystore fault is reported, not thrown", opening is VaultPrefs.Opening.Unavailable)
        assertTrue("the vault is kept", vaultFile().exists())
        assertFalse("nothing set aside", unreadableCopy().exists())
        assertFalse(plainState().getBoolean(VaultPrefs.RESET_NOTICE_FLAG, false))
    }

    @Test
    fun startingFreshOpensAnEmptyWalletAndKeepsACopy() {
        val wallet = WalletStore(context)
        runBlocking { wallet.createPassword("VaultKeystoreFaultTest!long-pass") }
        wallet.lock()
        Thread.sleep(500)
        replaceMasterKeyWithAnEncryptOnlyKey()
        assertTrue(VaultPrefs.attempt { WalletStore(context) } is VaultPrefs.Opening.Unavailable)

        VaultPrefs.startFresh(context)
        val fresh = VaultPrefs.attempt { WalletStore(context) }

        val store = (fresh as VaultPrefs.Opening.Open).value
        assertEquals(WalletStatus.UNINITIALIZED, store.status.value)
        assertTrue("the restore-from-backup notice shows", store.unreadableVaultNotice.value)
        assertTrue(unreadableCopy().exists())
    }

    /** Same alias, a key Keystore refuses to decrypt with. */
    private fun replaceMasterKeyWithAnEncryptOnlyKey() {
        keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(MasterKey.DEFAULT_MASTER_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    private fun prefsDir() = File(context.applicationInfo.dataDir, "shared_prefs")
    private fun vaultFile() = File(prefsDir(), "${VaultPrefs.FILE}.xml")
    private fun unreadableCopy() = File(prefsDir(), "${VaultPrefs.FILE}.unreadable.xml")
    private fun plainState() = context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE)

    private fun clearWalletState() {
        plainState().edit().clear().commit()
        context.deleteSharedPreferences(VaultPrefs.FILE)
        unreadableCopy().delete()
        try { keyStore.deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS) } catch (_: Exception) {}
    }
}
