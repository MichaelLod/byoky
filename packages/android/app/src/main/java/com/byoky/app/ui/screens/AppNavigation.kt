package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.byoky.app.data.WalletStatus
import com.byoky.app.data.WalletStore
import com.byoky.app.relay.RelayPairService
import com.byoky.app.ui.theme.Accent

@Composable
fun AppNavigation(wallet: WalletStore) {
    val status by wallet.status.collectAsState()

    when (status) {
        WalletStatus.UNINITIALIZED -> OnboardingScreen(wallet)
        WalletStatus.LOCKED -> UnlockScreen(wallet)
        WalletStatus.UNLOCKED -> MainScreen(wallet)
    }
}

@Composable
private fun MainScreen(wallet: WalletStore) {
    val navController = rememberNavController()
    var selectedTab by remember { mutableIntStateOf(0) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val pairService = remember { RelayPairService(context.applicationContext) }

    val tabs = listOf(
        Triple("Wallet", Icons.Default.Wallet, "wallet"),
        Triple("Gifts", Icons.Default.CardGiftcard, "gifts"),
        Triple("Connect", Icons.Default.CellTower, "connect"),
        Triple("Usage", Icons.Default.BarChart, "usage"),
        Triple("Sessions", Icons.Default.Link, "sessions"),
    )

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                windowInsets = WindowInsets(left = 8.dp, right = 8.dp),
            ) {
                tabs.forEachIndexed { index, (label, icon, _) ->
                    NavigationBarItem(
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label, fontSize = androidx.compose.ui.unit.TextUnit(10f, androidx.compose.ui.unit.TextUnitType.Sp)) },
                        selected = selectedTab == index,
                        onClick = {
                            selectedTab = index
                            navController.navigate(tabs[index].third) {
                                popUpTo("wallet") { inclusive = false }
                                launchSingleTop = true
                            }
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Accent,
                            selectedTextColor = Accent,
                            indicatorColor = Accent.copy(alpha = 0.12f),
                        ),
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "wallet",
            modifier = Modifier.padding(padding),
        ) {
            composable("wallet") {
                WalletScreen(
                    wallet = wallet,
                    onNavigateToSettings = {
                        navController.navigate("settings") { launchSingleTop = true }
                    },
                )
            }
            composable("gifts") {
                GiftsScreen(
                    wallet = wallet,
                    onNavigateToCreate = {
                        navController.navigate("create-gift") { launchSingleTop = true }
                    },
                    onNavigateToRedeem = {
                        navController.navigate("redeem-gift") { launchSingleTop = true }
                    },
                )
            }
            composable("create-gift") {
                CreateGiftScreen(wallet = wallet, onBack = { navController.popBackStack() })
            }
            composable("redeem-gift") {
                RedeemGiftScreen(wallet = wallet, onBack = { navController.popBackStack() })
            }
            composable("connect") { ConnectScreen(wallet, pairService) }
            composable("usage") { UsageScreen(wallet) }
            composable("sessions") { SessionsScreen(wallet) }
            composable("settings") { SettingsScreen(wallet) }
        }
    }
}
