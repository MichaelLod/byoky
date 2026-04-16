package com.byoky.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.screens.AppNavigation
import com.byoky.app.ui.theme.ByokyTheme

class MainActivity : ComponentActivity() {
    private lateinit var lifecycleObserver: DefaultLifecycleObserver

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val wallet = (application as ByokyApp).walletStore

        // Test-only auto-setup. Driven by the UI Automator harness which
        // launches MainActivity with byoky_test_config_json extras.
        // No-op for production launches (extras absent).
        TestSupport.autoSetupIfNeeded(applicationContext, wallet, intent?.extras)

        handleDeepLinkIntent(intent, wallet)

        lifecycleObserver = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                wallet.recordBackgroundTime()
                com.byoky.app.relay.GiftRelayHost.disconnectAll()
                wallet.stopMarketplaceHeartbeat()
            }

            override fun onStart(owner: LifecycleOwner) {
                wallet.checkAutoLock()
                if (wallet.status.value == com.byoky.app.data.WalletStatus.UNLOCKED) {
                    com.byoky.app.relay.GiftRelayHost.reconnectAll()
                    wallet.reconcileGiftUsageOnForeground()
                    wallet.startMarketplaceHeartbeat()
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val wallet = (application as ByokyApp).walletStore
        handleDeepLinkIntent(intent, wallet)
    }

    private fun handleDeepLinkIntent(intent: Intent?, wallet: WalletStore) {
        val uri = intent?.data ?: return
        if (uri.scheme != "byoky") return
        when (uri.host) {
            "pair" -> wallet.setPendingPairLink(uri.toString())
            "gift" -> wallet.setPendingGiftLink(uri.toString())
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::lifecycleObserver.isInitialized) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
    }
}
