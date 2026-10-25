package com.byoky.app

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

    private val wallet: WalletStore get() = (application as ByokyApp).walletStore

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val wallet = wallet

        // Auto-lock: the wallet locks itself after the idle timeout while the
        // app is open (WalletStore's idle watch); here it learns when the app
        // goes to the background and comes back, and locks on return if it
        // stayed away longer than the timeout.
        lifecycleObserver = object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) {
                wallet.recordBackgroundTime()
            }

            override fun onStart(owner: LifecycleOwner) {
                wallet.checkAutoLock()
            }
        }

        ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)

        setContent {
            ByokyTheme {
                AppNavigation(wallet = wallet)
            }
        }
    }

    // Any touch or key press in the activity's window (the in-wallet browser
    // included) counts as interaction and restarts the idle timeout.
    override fun onUserInteraction() {
        super.onUserInteraction()
        wallet.noteActivity()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::lifecycleObserver.isInitialized) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
    }
}
