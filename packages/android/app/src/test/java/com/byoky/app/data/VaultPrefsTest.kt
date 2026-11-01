package com.byoky.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun aKeysetWithoutItsKeystoreKeyIsSetAsideBeforeOpening() {
        assertTrue(VaultPrefs.mustReset(vaultHasKeyset = true, masterKeyExists = false))
        assertFalse(VaultPrefs.mustReset(vaultHasKeyset = true, masterKeyExists = true))
        assertFalse(VaultPrefs.mustReset(vaultHasKeyset = false, masterKeyExists = false))
    }
}
