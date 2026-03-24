package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.byoky.app.data.WalletStore
import com.byoky.app.relay.RelayPairService
import com.byoky.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectScreen(wallet: WalletStore, pairService: RelayPairService) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Pair", "Bridge")

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Connect") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            TabRow(
                selectedTabIndex = selectedTab,
                containerColor = BgMain,
                contentColor = Accent,
                indicator = { tabPositions ->
                    TabRowDefaults.SecondaryIndicator(
                        Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                        color = Accent,
                    )
                },
            ) {
                tabs.forEachIndexed { index, title ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(title) },
                        selectedContentColor = Accent,
                        unselectedContentColor = TextSecondary,
                    )
                }
            }

            when (selectedTab) {
                0 -> PairContent(wallet, pairService)
                1 -> BridgeContent(wallet)
            }
        }
    }
}
