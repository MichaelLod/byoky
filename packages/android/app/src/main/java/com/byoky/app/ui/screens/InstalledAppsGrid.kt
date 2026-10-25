package com.byoky.app.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RetroDropdownMenu
import com.byoky.app.ui.components.panel
import com.byoky.app.ui.theme.*

/**
 * Launcher grid of the user's installed web apps. Tap opens the app in the
 * in-wallet browser; long-press shows Open / Enable-Disable / Remove.
 */
@Composable
fun InstalledAppsGrid(
    wallet: WalletStore,
    onOpenApp: (InstalledApp) -> Unit,
    onAddApp: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val apps by wallet.installedApps.collectAsState()

    if (apps.isEmpty()) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .border(1.dp, SeamStrong),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Apps, contentDescription = null, modifier = Modifier.size(28.dp), tint = Phosphor)
            }
            Spacer(Modifier.height(18.dp))
            CapsText("No apps yet", style = HeadingStyle, color = Bone)
            Spacer(Modifier.height(8.dp))
            Text(
                "Add a web app by its address. It opens inside the wallet and uses your keys without ever seeing them.",
                fontSize = 14.sp,
                lineHeight = 20.sp,
                color = Fog,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(24.dp))
            PrimaryButton("Add app", onClick = onAddApp, icon = Icons.Default.Add)
        }
        return
    }

    val ordered = apps.filter { it.enabled } + apps.filter { !it.enabled }

    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        items(ordered, key = { it.id }) { app ->
            AppIconItem(app = app, wallet = wallet, onOpen = { onOpenApp(app) })
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Text(
                "Long-press an app for more options.",
                style = MonoStyle.copy(fontSize = 11.sp),
                color = Dim,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AppIconItem(
    app: InstalledApp,
    wallet: WalletStore,
    onOpen: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .alpha(if (app.enabled) 1f else 0.4f)
            .combinedClickable(
                onClick = { if (app.enabled) onOpen() else showMenu = true },
                onLongClick = { showMenu = true },
                onLongClickLabel = "App options",
            ),
    ) {
        Box {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .panel(border = SeamStrong),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = app.name.take(1).uppercase(),
                    style = HeadingStyle.copy(fontSize = 24.sp, lineHeight = 28.sp),
                    color = Lilac,
                )
            }

            RetroDropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                if (app.enabled) {
                    DropdownMenuItem(
                        text = { Text("Open", color = Bone) },
                        onClick = { showMenu = false; onOpen() },
                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = Phosphor) },
                    )
                }
                DropdownMenuItem(
                    text = { Text(if (app.enabled) "Disable" else "Enable", color = Bone) },
                    onClick = { wallet.toggleApp(app.id); showMenu = false },
                    leadingIcon = { Icon(if (app.enabled) Icons.Default.PowerSettingsNew else Icons.Default.Power, contentDescription = null, tint = Phosphor) },
                )
                DropdownMenuItem(
                    text = { Text("Remove", color = Alarm) },
                    onClick = { wallet.uninstallApp(app.id); showMenu = false },
                    leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = Alarm) },
                )
            }
        }

        Spacer(Modifier.height(4.dp))

        Text(
            text = app.name,
            fontSize = 12.sp,
            color = Fog,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 70.dp),
        )
    }
}
