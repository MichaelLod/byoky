package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
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
    var fabMenuOpen by remember { mutableStateOf(false) }
    var showAddCredentialFromFab by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val pairService = remember { RelayPairService(context.applicationContext) }

    val tabs = listOf(
        Triple("Wallet", Icons.Default.Wallet, "wallet"),
        Triple("Gifts", Icons.Default.CardGiftcard, "gifts"),
        Triple("Connect", Icons.Default.CellTower, "connect"),
        Triple("Usage", Icons.Default.BarChart, "usage"),
        Triple("Apps", Icons.Default.Apps, "apps"),
    )

    // Hide FAB on routes where the global "+" actions don't make sense (the
    // user is already inside one of the targets).
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showFab = currentRoute !in setOf("redeem-gift", "create-gift", "settings")

    Scaffold(
        floatingActionButton = {
            if (showFab) {
                Box {
                    FloatingActionButton(
                        onClick = { fabMenuOpen = true },
                        containerColor = Color.Transparent,
                        shape = CircleShape,
                        modifier = Modifier
                            .shadow(elevation = 8.dp, shape = CircleShape, ambientColor = Accent, spotColor = Accent)
                            .clip(CircleShape)
                            .background(
                                brush = Brush.linearGradient(
                                    colors = listOf(Color(0xFF38BDF8), Accent),
                                ),
                            )
                            .size(56.dp),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Open add menu", tint = Color.White)
                    }
                    DropdownMenu(
                        expanded = fabMenuOpen,
                        onDismissRequest = { fabMenuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Add credential") },
                            leadingIcon = { Icon(Icons.Default.Key, null, tint = Accent) },
                            onClick = {
                                fabMenuOpen = false
                                showAddCredentialFromFab = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Redeem gift") },
                            leadingIcon = { Icon(Icons.Default.Redeem, null, tint = Accent) },
                            onClick = {
                                fabMenuOpen = false
                                navController.navigate("redeem-gift") { launchSingleTop = true }
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Add app") },
                            leadingIcon = { Icon(Icons.Default.Apps, null, tint = Accent) },
                            onClick = {
                                fabMenuOpen = false
                                selectedTab = 4
                                navController.navigate("apps") {
                                    popUpTo("wallet") { inclusive = false }
                                    launchSingleTop = true
                                }
                            },
                        )
                    }
                }
            }
        },
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
                    onNavigateToRedeemGift = {
                        navController.navigate("redeem-gift") { launchSingleTop = true }
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
            composable("apps") { MarketplaceTabScreen(wallet) }
            composable("settings") { SettingsScreen(wallet) }
        }
    }

    if (showAddCredentialFromFab) {
        AddCredentialSheet(wallet) { showAddCredentialFromFab = false }
    }
}
