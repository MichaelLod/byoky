package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import com.byoky.app.ui.theme.AccentHover

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
        Triple("Apps", Icons.Default.Apps, "apps"),
        Triple("Connect", Icons.Default.CellTower, "connect"),
        Triple("Usage", Icons.Default.BarChart, "usage"),
    )

    // Hide FAB on routes where the global "+" actions don't make sense (the
    // user is already inside one of the targets).
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showFab = currentRoute !in setOf("redeem-gift", "create-gift", "settings", "app-store")

    // When a byoky://pair/<payload> deep link arrives, MainActivity sets
    // wallet.pendingPairLink. Switch to the Connect tab so PairContent can
    // pick it up and kick off the relay handshake.
    val pendingPairLink by wallet.pendingPairLink.collectAsState()
    val connectIndex = tabs.indexOfFirst { it.third == "connect" }
    LaunchedEffect(pendingPairLink) {
        if (pendingPairLink != null && connectIndex >= 0) {
            selectedTab = connectIndex
            navController.navigate("connect") {
                popUpTo("wallet") { inclusive = false }
                launchSingleTop = true
            }
        }
    }

    // byoky://gift/<payload> deep link: route to the redeem-gift screen
    // which pulls the link from wallet.pendingGiftLink on appear.
    val pendingGiftLink by wallet.pendingGiftLink.collectAsState()
    LaunchedEffect(pendingGiftLink) {
        if (pendingGiftLink != null) {
            navController.navigate("redeem-gift") { launchSingleTop = true }
        }
    }

    Scaffold(
        floatingActionButton = {
            if (showFab) {
                Box {
                    Box(
                        modifier = Modifier
                            .shadow(elevation = 8.dp, shape = CircleShape, ambientColor = Accent, spotColor = Accent)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(colors = listOf(AccentHover, Accent)))
                            .size(56.dp)
                            .clickable { fabMenuOpen = true },
                        contentAlignment = Alignment.Center,
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
                                navController.navigate("app-store") { launchSingleTop = true }
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
            composable("apps") {
                MarketplaceTabScreen(
                    wallet = wallet,
                    onBrowseStore = { navController.navigate("app-store") { launchSingleTop = true } },
                )
            }
            composable("app-store") {
                AppStoreScreen(wallet = wallet, onBack = { navController.popBackStack() })
            }
            composable("settings") { SettingsScreen(wallet) }
        }
    }

    if (showAddCredentialFromFab) {
        AddCredentialSheet(wallet) { showAddCredentialFromFab = false }
    }
}
