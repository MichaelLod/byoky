package com.byoky.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.graphics.toArgb
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.screens.AppNavigation
import com.byoky.app.ui.screens.VaultUnavailableScreen
import com.byoky.app.ui.theme.ByokyTheme
import com.byoky.app.ui.theme.Void

class MainActivity : ComponentActivity() {
    private lateinit var lifecycleObserver: DefaultLifecycleObserver

    /** Null while the Keystore won't open the wallet (VaultUnavailableScreen). */
    private var wallet: WalletStore? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // Dark only: light system-bar icons over void, whatever the system theme.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Void.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(Void.toArgb()),
        )

        val app = application as ByokyApp
        val wallet = app.walletStore
        if (wallet == null) {
            showVaultUnavailable(app)
            return
        }
        this.wallet = wallet

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

    /**
     * The phone's Keystore refused the key that protects the wallet: explain,
     * and once it opens (another try, or a fresh wallet the user asked for)
     * start over with the wallet.
     */
    private fun showVaultUnavailable(app: ByokyApp) {
        setContent {
            ByokyTheme {
                VaultUnavailableScreen(
                    tryAgain = app::retryOpen,
                    startFresh = app::startFreshAndOpen,
                    onOpened = ::recreate,
                )
            }
        }
    }

    // Any touch or key press in the activity's window (the in-wallet browser
    // included) counts as interaction and restarts the idle timeout.
    override fun onUserInteraction() {
        super.onUserInteraction()
        wallet?.noteActivity()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::lifecycleObserver.isInitialized) {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(lifecycleObserver)
        }
    }
}
