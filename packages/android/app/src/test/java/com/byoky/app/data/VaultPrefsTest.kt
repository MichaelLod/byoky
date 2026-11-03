package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStoreException
import java.security.ProviderException
import javax.crypto.AEADBadTagException

/** When an unreadable vault is set aside, and when it never is. */
class VaultPrefsTest {

    @Test
    fun aVaultThatCanNeverBeReadIsReset() {
        // Wrapped by a key this device doesn't have, or a corrupt keyset.
        assertEquals(VaultPrefs.Recovery.RESET, VaultPrefs.recoveryFor(AEADBadTagException("tag mismatch")))
        assertEquals(VaultPrefs.Recovery.RESET, VaultPrefs.recoveryFor(GeneralSecurityException("decryption failed", AEADBadTagException())))
        // protobuf's InvalidProtocolBufferException (a corrupt keyset) is an IOException.
        class InvalidProtocolBuffer : IOException("bad keyset")
        assertEquals(VaultPrefs.Recovery.RESET, VaultPrefs.recoveryFor(InvalidProtocolBuffer()))
        assertEquals(VaultPrefs.Recovery.RESET, VaultPrefs.recoveryFor(IOException("unreadable")))
    }

    @Test
    fun keystoreFaultsAreRetriedNeverWiped() {
        assertEquals(VaultPrefs.Recovery.RETRY, VaultPrefs.recoveryFor(KeyStoreException("keystore busy")))
        assertEquals(VaultPrefs.Recovery.RETRY, VaultPrefs.recoveryFor(ProviderException("provider failed")))
        // Transient beats definitive anywhere in the chain.
        assertEquals(
            VaultPrefs.Recovery.RETRY,
            VaultPrefs.recoveryFor(GeneralSecurityException("wrapped", AEADBadTagException().apply { initCause(KeyStoreException("x")) })),
        )
    }

    @Test
    fun otherErrorsAreLetThrough() {
        assertEquals(VaultPrefs.Recovery.FAIL, VaultPrefs.recoveryFor(IllegalStateException("bug")))
        assertEquals(VaultPrefs.Recovery.FAIL, VaultPrefs.recoveryFor(OutOfMemoryError()))
    }

    @Test
    fun aKeystoreFaultThatOutlastsTheRetryLeavesTheWalletUnavailableNotCrashed() {
        // As VaultPrefs.open rethrows it after its one retry ("Invalid key blob").
        val fault = java.security.InvalidKeyException("Keystore operation failed", KeyStoreException("Invalid key blob"))
        val opening = VaultPrefs.attempt<String> { throw fault }
        assertTrue(opening is VaultPrefs.Opening.Unavailable)
        assertSame(fault, (opening as VaultPrefs.Opening.Unavailable).error)

        val opened = VaultPrefs.attempt { "wallet" }
        assertEquals("wallet", (opened as VaultPrefs.Opening.Open).value)
    }

    @Test
    fun aBugStillCrashesInsteadOfShowingTheKeystoreScreen() {
        assertThrows(IllegalStateException::class.java) {
            VaultPrefs.attempt<String> { throw IllegalStateException("bug") }
        }
        // A vault that stayed unreadable after being set aside is not a Keystore fault either.
        assertThrows(AEADBadTagException::class.java) {
            VaultPrefs.attempt<String> { throw AEADBadTagException("still unreadable") }
        }
    }

    @Test
    fun aKeysetWithoutItsKeystoreKeyIsSetAsideBeforeOpening() {
        assertTrue(VaultPrefs.mustReset(vaultHasKeyset = true, masterKeyExists = false))
        assertFalse(VaultPrefs.mustReset(vaultHasKeyset = true, masterKeyExists = true))
        assertFalse(VaultPrefs.mustReset(vaultHasKeyset = false, masterKeyExists = false))
    }
}
