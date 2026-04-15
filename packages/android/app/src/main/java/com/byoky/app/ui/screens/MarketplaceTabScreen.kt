package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.Accent
import com.byoky.app.ui.theme.BgMain
import com.byoky.app.ui.theme.TextPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MarketplaceTabScreen(wallet: WalletStore, onBrowseStore: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Apps") },
                actions = {
                    IconButton(onClick = onBrowseStore) {
                        Icon(Icons.Default.Add, contentDescription = "Browse store", tint = Accent)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        InstalledAppsGrid(wallet, onBrowseStore = onBrowseStore, modifier = Modifier.padding(padding))
    }
}
