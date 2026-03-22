package com.byoky.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.byoky.app.ui.screens.AppNavigation
import com.byoky.app.ui.theme.ByokyTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val wallet = (application as ByokyApp).walletStore

        setContent {
            ByokyTheme {
                AppNavigation(wallet = wallet)
            }
        }
    }
}
