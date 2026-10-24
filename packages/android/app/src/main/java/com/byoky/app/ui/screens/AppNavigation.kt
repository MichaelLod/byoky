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
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStatus
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.Accent
import com.byoky.app.ui.theme.AccentHover

private const val APP_RUNTIME_ROUTE = "app/{appId}"

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
    var fabMenuOpen by remember { mutableStateOf(false) }
    var showAddCredential by remember { mutableStateOf(false) }
    var showAddApp by remember { mutableStateOf(false) }

    val tabs = listOf(
        Triple("Wallet", Icons.Default.Wallet, "wallet"),
        Triple("Apps", Icons.Default.Apps, "apps"),
        Triple("Connected", Icons.Default.Link, "connected"),
    )

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val inAppRuntime = currentRoute == APP_RUNTIME_ROUTE
    // Settings is pushed from the Wallet tab, so keep that tab highlighted.
    val selectedTab = tabs.indexOfFirst { it.third == currentRoute }
        .takeIf { it >= 0 } ?: if (currentRoute == "settings") 0 else -1
    val showFab = !inAppRuntime && currentRoute != "settings"

    // Opening an app is explicit consent: lift any revoke block for its origin.
    fun openApp(app: InstalledApp) {
        wallet.allowOrigin(app.origin)
        navController.navigate("app/${app.id}") { launchSingleTop = true }
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
                                showAddCredential = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Add app") },
                            leadingIcon = { Icon(Icons.Default.Apps, null, tint = Accent) },
                            onClick = {
                                fabMenuOpen = false
                                showAddApp = true
                            },
                        )
                    }
                }
            }
        },
        bottomBar = {
            if (!inAppRuntime) {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    windowInsets = WindowInsets(left = 8.dp, right = 8.dp),
                ) {
                    tabs.forEachIndexed { index, (label, icon, route) ->
                        NavigationBarItem(
                            icon = { Icon(icon, contentDescription = label) },
                            label = { Text(label, fontSize = androidx.compose.ui.unit.TextUnit(10f, androidx.compose.ui.unit.TextUnitType.Sp)) },
                            selected = selectedTab == index,
                            onClick = {
                                navController.navigate(route) {
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
            composable("apps") {
                InstalledAppsScreen(
                    wallet = wallet,
                    onOpenApp = { openApp(it) },
                    onAddApp = { showAddApp = true },
                )
            }
            composable("connected") { AppsScreen(wallet) }
            composable(APP_RUNTIME_ROUTE) { entry ->
                AppRuntimeScreen(
                    wallet = wallet,
                    appId = entry.arguments?.getString("appId").orEmpty(),
                    onClose = { navController.popBackStack() },
                )
            }
            composable("settings") { SettingsScreen(wallet) }
        }
    }

    if (showAddCredential) {
        AddCredentialSheet(wallet) { showAddCredential = false }
    }

    if (showAddApp) {
        AddAppDialog(
            wallet = wallet,
            onDismiss = { showAddApp = false },
            onAdded = { app ->
                showAddApp = false
                openApp(app)
            },
        )
    }
}
