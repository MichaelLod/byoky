package com.byoky.app

import android.content.ClipboardManager
import android.content.ClipData
import android.content.Context
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
        checkClipboardForDeferredGift(wallet)

        lifecycleObserver = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                wallet.recordBackgroundTime()
                com.byoky.app.relay.GiftRelayHost.disconnectAll()
            }

            override fun onStart(owner: LifecycleOwner) {
                wallet.checkAutoLock()
                if (wallet.status.value == com.byoky.app.data.WalletStatus.UNLOCKED) {
                    com.byoky.app.relay.GiftRelayHost.reconnectAll()
                    wallet.reconcileGiftUsageOnForeground()
                }
                checkClipboardForDeferredGift(wallet)
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
            // Both long (byoky://gift/<encoded>) and short (byoky://g/<id>)
            // shapes route to the redeem screen — RedeemGiftScreen resolves
            // short ids via the vault before decoding.
            "gift", "g" -> wallet.setPendingGiftLink(uri.toString())
        }
    }

    // Fallback for when the web redeem page's intent:// redirect doesn't
    // auto-foreground the app. The web page stashes the gift URL on the
    // clipboard before firing the deep link, so we can pick it up whenever
    // the user manually returns to the app.
    private fun checkClipboardForDeferredGift(wallet: WalletStore) {
        if (wallet.pendingGiftLink.value != null) return
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        val clip = clipboard.primaryClip ?: return
        if (clip.itemCount == 0) return
        val text = clip.getItemAt(0).text?.toString() ?: return
        if (text.startsWith("https://byoky.com/gift")
            || text.startsWith("https://byoky.com/g/")
            || text.startsWith("byoky://gift")
            || text.startsWith("byoky://g/")) {
            wallet.setPendingGiftLink(text)
            clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::lifecycleObserver.isInitialized) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
    }
}
