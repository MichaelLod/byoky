package com.byoky.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.byoky.app.ui.screens.AppNavigation
import com.byoky.app.ui.theme.ByokyTheme

class MainActivity : ComponentActivity() {
    private lateinit var lifecycleObserver: DefaultLifecycleObserver

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val wallet = (application as ByokyApp).walletStore

        lifecycleObserver = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                wallet.recordBackgroundTime()
                com.byoky.app.relay.GiftRelayHost.disconnectAll()
            }

            override fun onStart(owner: LifecycleOwner) {
                wallet.checkAutoLock()
                if (wallet.status.value == com.byoky.app.data.WalletStatus.UNLOCKED) {
                    com.byoky.app.relay.GiftRelayHost.reconnectAll()
                }
            }
        }

        ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)

        setContent {
            ByokyTheme {
                AppNavigation(wallet = wallet)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::lifecycleObserver.isInitialized) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
    }
}
