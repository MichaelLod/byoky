package com.byoky.app

import android.app.Application
import com.byoky.app.data.WalletStore

class ByokyApp : Application() {
    lateinit var walletStore: WalletStore
        private set

    override fun onCreate() {
        super.onCreate()
        walletStore = WalletStore(this)
    }
}
