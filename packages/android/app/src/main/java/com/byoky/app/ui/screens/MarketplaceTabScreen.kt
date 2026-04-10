package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.byoky.app.data.WalletStore

@Composable
fun MarketplaceTabScreen(wallet: WalletStore) {
    var tab by remember { mutableIntStateOf(0) }

    Column {
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("My Apps") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Sessions") })
        }

        when (tab) {
            0 -> InstalledAppsGrid(wallet)
            1 -> AppsScreen(wallet)
        }
    }
}
