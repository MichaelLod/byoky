package com.byoky.app

import android.app.Application
import com.byoky.app.data.VaultPrefs
import com.byoky.app.data.WalletStore

class ByokyApp : Application() {
    /**
     * The wallet, or null while the phone's Keystore refuses the key that
     * protects it (see [VaultPrefs.attempt]). MainActivity then explains
     * that instead of the app crashing on every launch.
     */
    @Volatile var walletStore: WalletStore? = null
        private set

    override fun onCreate() {
        super.onCreate()
        open()
    }

    /** Open the wallet again, in case the Keystore recovered. True once it is open. */
    @Synchronized
    fun retryOpen(): Boolean = walletStore != null || open()

    /**
     * Set aside the vault this phone can't open and start an empty wallet
     * (restorable from a `.byoky` backup). Only on the user's confirmation.
     * True once the new wallet is open.
     */
    @Synchronized
    fun startFreshAndOpen(): Boolean {
        if (walletStore != null) return true
        VaultPrefs.startFresh(this)
        return open()
    }

    private fun open(): Boolean = when (val opening = VaultPrefs.attempt { WalletStore(this) }) {
        is VaultPrefs.Opening.Open -> {
            walletStore = opening.value
            true
        }
        is VaultPrefs.Opening.Unavailable -> false
    }
}
