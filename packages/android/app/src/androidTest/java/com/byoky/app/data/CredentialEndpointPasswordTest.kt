package com.byoky.app.data

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Where a key is sent changes only with the wallet password: an unlocked
 * phone alone can't repoint an Azure (or local server) key at another host.
 */
@RunWith(AndroidJUnit4::class)
class CredentialEndpointPasswordTest {
    private lateinit var context: Context
    private lateinit var wallet: WalletStore
    private val password = "CredentialEndpointPasswordTest!long"

    @Before
    fun setup() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearWalletState()
        wallet = WalletStore(context)
        runBlocking { wallet.createPassword(password) }
    }

    @After
    fun tearDown() {
        wallet.lock()
        clearWalletState()
    }

    private fun azure(baseUrl: String?): Credential = runBlocking {
        if (baseUrl == null) {
            // A key from before endpoints were required: set its baseUrl to null.
            wallet.addCredential("azure_openai", "Azure", "azure-endpoint-test-key", baseUrl = "https://contoso.openai.azure.com")
            val added = wallet.credentials.value.last()
            val credentials = WalletStore::class.java.getDeclaredField("_credentials").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val flow = credentials.get(wallet) as kotlinx.coroutines.flow.MutableStateFlow<List<Credential>>
            flow.value = flow.value.map { if (it.id == added.id) it.copy(baseUrl = null) else it }
        } else {
            wallet.addCredential("azure_openai", "Azure", "azure-endpoint-test-key", baseUrl = baseUrl)
        }
        wallet.credentials.value.last()
    }

    private fun baseUrlOf(id: String) = wallet.credentials.value.first { it.id == id }.baseUrl

    @Test
    fun aWrongPasswordLeavesTheEndpointAlone() = runBlocking {
        val key = azure("https://contoso.openai.azure.com")

        val result = wallet.updateCredentialEndpoint(key.id, "https://attacker.example", "not the password")

        assertEquals(UnlockResult.WrongPassword, result)
        assertEquals("https://contoso.openai.azure.com", baseUrlOf(key.id))
    }

    @Test
    fun theWalletPasswordChangesIt() = runBlocking {
        val key = azure("https://contoso.openai.azure.com")

        val result = wallet.updateCredentialEndpoint(key.id, "https://fabrikam.openai.azure.com/", password)

        assertEquals(UnlockResult.Success, result)
        assertEquals("https://fabrikam.openai.azure.com", baseUrlOf(key.id))
    }

    @Test
    fun aKeyWithoutAnEndpointNeedsThePasswordToGetOne() = runBlocking {
        // Giving a key a destination sends it there just as much as changing one.
        val key = azure(null)
        assertNull(baseUrlOf(key.id))

        assertEquals(UnlockResult.WrongPassword, wallet.updateCredentialEndpoint(key.id, "https://attacker.example", "a guess"))
        assertNull(baseUrlOf(key.id))

        assertEquals(UnlockResult.Success, wallet.updateCredentialEndpoint(key.id, "https://contoso.openai.azure.com", password))
        assertEquals("https://contoso.openai.azure.com", baseUrlOf(key.id))
    }

    @Test
    fun wrongPasswordsCountTowardTheUnlockLockout() = runBlocking {
        val key = azure("https://contoso.openai.azure.com")

        var last: UnlockResult = UnlockResult.Success
        repeat(6) { last = wallet.updateCredentialEndpoint(key.id, "https://attacker.example", "guess $it") }

        assertTrue(last is UnlockResult.LockedOut)
        assertNotNull(wallet.lockoutUntil.value)
        // Locked out, even the right password is refused for now.
        assertTrue(wallet.updateCredentialEndpoint(key.id, "https://fabrikam.openai.azure.com", password) is UnlockResult.LockedOut)
        assertEquals("https://contoso.openai.azure.com", baseUrlOf(key.id))
    }

    @Test
    fun anUnusableUrlIsRejectedBeforeThePasswordIsTried() = runBlocking {
        val key = azure("https://contoso.openai.azure.com")

        assertThrows(IllegalArgumentException::class.java) {
            runBlocking { wallet.updateCredentialEndpoint(key.id, "http://attacker.example", "not the password") }
        }
        // No attempt was spent on it.
        assertEquals(0, plainState().getInt(UnlockThrottle.ATTEMPTS, 0))
        assertEquals("https://contoso.openai.azure.com", baseUrlOf(key.id))
        assertEquals(UnlockResult.Success, wallet.updateCredentialEndpoint(key.id, "https://fabrikam.openai.azure.com", password))
    }

    private fun plainState() = context.getSharedPreferences(VaultPrefs.PLAIN_STATE_FILE, Context.MODE_PRIVATE)

    private fun clearWalletState() {
        plainState().edit().clear().commit()
        try { context.deleteSharedPreferences(WalletStore.ENCRYPTED_PREFS_FILE) } catch (_: Throwable) {}
    }
}
