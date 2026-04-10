package com.byoky.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

@Composable
fun InstalledAppsGrid(wallet: WalletStore) {
    val apps by wallet.installedApps.collectAsState()
    var showStore by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val enabledApps = apps.filter { it.enabled }
    val disabledApps = apps.filter { !it.enabled }

    if (showStore) {
        AppStoreScreen(wallet = wallet, onBack = { showStore = false })
        return
    }

    if (apps.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.Apps, contentDescription = null, modifier = Modifier.size(48.dp), tint = TextMuted)
                Text("No apps installed", color = TextSecondary)
                Text("Browse the store to find apps that use your API keys.", fontSize = 13.sp, color = TextMuted, textAlign = TextAlign.Center)
                Button(onClick = { showStore = true }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) {
                    Text("Browse Store")
                }
            }
        }
        return
    }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = { showStore = true }) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Store")
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(enabledApps, key = { it.id }) { app ->
                AppIconItem(app = app, wallet = wallet) {
                    val uri = Uri.parse(app.url)
                    if (uri.scheme == "https") {
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        context.startActivity(intent)
                    }
                }
            }

            if (disabledApps.isNotEmpty()) {
                items(disabledApps, key = { it.id }) { app ->
                    Box(modifier = Modifier.alpha(0.4f)) {
                        AppIconItem(app = app, wallet = wallet, onClick = {})
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppIconItem(
    app: InstalledApp,
    wallet: WalletStore,
    onClick: () -> Unit,
) {
    var showMenu by remember { mutableStateOf(false) }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick),
    ) {
        Box {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(AccentSoft),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = app.name.take(1).uppercase(),
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = Accent,
                )
            }

            DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                DropdownMenuItem(
                    text = { Text(if (app.enabled) "Disable" else "Enable") },
                    onClick = { wallet.toggleApp(app.id); showMenu = false },
                    leadingIcon = { Icon(if (app.enabled) Icons.Default.PowerSettingsNew else Icons.Default.Power, contentDescription = null) },
                )
                DropdownMenuItem(
                    text = { Text("Uninstall") },
                    onClick = { wallet.uninstallApp(app.id); showMenu = false },
                    leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null) },
                    colors = MenuDefaults.itemColors(textColor = MaterialTheme.colorScheme.error),
                )
            }
        }

        Spacer(Modifier.height(4.dp))

        Text(
            text = app.name,
            fontSize = 11.sp,
            color = TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .widthIn(max = 70.dp)
                .clickable { showMenu = true },
        )
    }
}
