package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.byoky.app.data.AppOpenGate
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStatus
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.GhostButton
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RavenFrame
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetroDropdownMenu
import com.byoky.app.ui.components.StatusLine
import com.byoky.app.ui.components.cornerBrackets
import com.byoky.app.ui.components.panel
import com.byoky.app.ui.theme.*

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

    // Muninn nods once in the wallet header when the wallet has just been unlocked.
    var unlockNodPending by remember { mutableStateOf(true) }

    // Set while asking to reconnect an app the user disconnected.
    var reconnectPrompt by remember { mutableStateOf<AppOpenGate.Decision.ConfirmReconnect?>(null) }

    // Opening an app is consent to connect it, unless the user revoked its
    // origin in Connected Apps: then they confirm the reconnect first.
    fun openApp(app: InstalledApp) {
        when (val decision = wallet.openDecision(app)) {
            AppOpenGate.Decision.Open -> navController.navigate("app/${app.id}") { launchSingleTop = true }
            is AppOpenGate.Decision.ConfirmReconnect -> reconnectPrompt = decision
        }
    }

    Scaffold(
        containerColor = Void,
        // Each tab draws its own header under the status bar; only the
        // navigation bar is reserved here.
        contentWindowInsets = WindowInsets.navigationBars,
        floatingActionButton = {
            if (showFab) {
                Box {
                    Box(
                        modifier = Modifier
                            .drawBehind {
                                val ring = 4.dp.toPx()
                                drawRect(
                                    Violet.copy(alpha = 0.2f),
                                    topLeft = Offset(-ring, -ring),
                                    size = Size(size.width + 2 * ring, size.height + 2 * ring),
                                )
                            }
                            .background(Violet)
                            .size(56.dp)
                            .clickable { fabMenuOpen = true },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Open add menu", tint = Color.White)
                    }
                    RetroDropdownMenu(
                        expanded = fabMenuOpen,
                        onDismissRequest = { fabMenuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Add credential", color = Bone) },
                            leadingIcon = { Icon(Icons.Default.Key, null, tint = Phosphor) },
                            onClick = {
                                fabMenuOpen = false
                                showAddCredential = true
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Add app", color = Bone) },
                            leadingIcon = { Icon(Icons.Default.Apps, null, tint = Phosphor) },
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
                    containerColor = Ink,
                    tonalElevation = 0.dp,
                    windowInsets = WindowInsets.navigationBars
                        .only(WindowInsetsSides.Bottom)
                        .add(WindowInsets(left = 8.dp, right = 8.dp)),
                    modifier = Modifier.drawBehind {
                        drawRect(Seam, size = Size(size.width, 1.dp.toPx()))
                    },
                ) {
                    tabs.forEachIndexed { index, (label, icon, route) ->
                        NavigationBarItem(
                            icon = { Icon(icon, contentDescription = label, modifier = Modifier.size(22.dp)) },
                            label = {
                                CapsText(
                                    label,
                                    style = MonoStyle.copy(fontSize = 10.sp, letterSpacing = 0.1.em),
                                )
                            },
                            selected = selectedTab == index,
                            onClick = {
                                navController.navigate(route) {
                                    popUpTo("wallet") { inclusive = false }
                                    launchSingleTop = true
                                }
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Lilac,
                                selectedTextColor = Lilac,
                                indicatorColor = Color.Transparent,
                                unselectedIconColor = Dim,
                                unselectedTextColor = Dim,
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
                    nodOnAppear = unlockNodPending,
                    onNodShown = { unlockNodPending = false },
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

    reconnectPrompt?.let { prompt ->
        ReconnectAppDialog(
            prompt = prompt,
            onReconnect = {
                reconnectPrompt = null
                wallet.allowOrigin(prompt.app.origin)
                navController.navigate("app/${prompt.app.id}") { launchSingleTop = true }
            },
            onDismiss = { reconnectPrompt = null },
        )
    }
}

/**
 * Asked before reopening an app whose access the user revoked: the wallet's
 * connection request, with Muninn on alert.
 */
@Composable
private fun ReconnectAppDialog(
    prompt: AppOpenGate.Decision.ConfirmReconnect,
    onReconnect: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Column(
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .widthIn(max = 440.dp)
                .fillMaxWidth()
                .panel()
                .cornerBrackets()
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Muninn(RavenMood.ALERT, modifier = Modifier.size(96.dp), frame = RavenFrame.BUST)
                Spacer(Modifier.width(12.dp))
                Column {
                    StatusLine("Connection request")
                    Spacer(Modifier.height(6.dp))
                    CapsText(
                        "Reconnect ${prompt.app.name}?",
                        style = HeadingStyle.copy(fontSize = 20.sp, lineHeight = 24.sp),
                        color = Bone,
                    )
                }
            }

            Spacer(Modifier.height(16.dp))

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .panel(background = Void, border = SeamStrong)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                Text(prompt.host, style = MonoStyle.copy(fontSize = 15.sp, lineHeight = 20.sp), color = Bone)
                Spacer(Modifier.height(2.dp))
                Text("wants to connect to your wallet again", fontSize = 13.sp, color = Fog)
            }

            Spacer(Modifier.height(12.dp))

            Text(
                "You disconnected ${prompt.host}. Reconnecting lets it send AI requests through your keys again. It never sees the keys.",
                color = Fog,
                fontSize = 13.sp,
                lineHeight = 19.sp,
            )

            Spacer(Modifier.height(20.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton("Cancel", onClick = onDismiss, modifier = Modifier.weight(1f))
                PrimaryButton("Reconnect", onClick = onReconnect, modifier = Modifier.weight(1f))
            }
        }
    }
}
