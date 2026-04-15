package com.byoky.app.ui.screens

import androidx.compose.runtime.*
import com.byoky.app.data.WalletStore

@Composable
fun MarketplaceTabScreen(wallet: WalletStore) {
    InstalledAppsGrid(wallet)
}
