package com.byoky.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.BuildConfig
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.TranslationEngine
import com.byoky.app.ui.components.DangerButton
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.RetroTopBar
import com.byoky.app.ui.components.SectionLabel
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.panel
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(wallet: WalletStore) {
    val context = LocalContext.current
    var showResetWalletConfirm by remember { mutableStateOf(false) }

    Scaffold(
        modifier = Modifier
            .background(Void)
            .dotGrid(),
        topBar = { RetroTopBar(title = "Settings") },
        containerColor = Color.Transparent,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Security
            SettingsCard(title = "Security") {
                SettingsRow(
                    icon = Icons.Default.Lock,
                    title = "Lock Wallet",
                    onClick = { wallet.lock() },
                )

                Spacer(Modifier.height(8.dp))

                InfoRow("Encryption", "AES-256-GCM")
                InfoRow("Key Derivation", "PBKDF2 (600K)")
                InfoRow("Storage", "On this device only")
            }

            BackupSection(wallet)

            // Translation engine debug — only shown in debug builds.
            if (BuildConfig.DEBUG) {
                TranslationDebugCard()
            }

            // About
            SettingsCard(title = "About") {
                InfoRow("Version", BuildConfig.VERSION_NAME)

                Spacer(Modifier.height(8.dp))

                SettingsRow(
                    icon = Icons.Default.Code,
                    title = "GitHub",
                    external = true,
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/MichaelLod/byoky"))
                        )
                    },
                )

                SettingsRow(
                    icon = Icons.Default.Language,
                    title = "Website",
                    external = true,
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://byoky.com"))
                        )
                    },
                )
            }

            // Danger Zone
            SettingsCard(title = "Danger Zone", titleColor = Alarm) {
                Text(
                    "Reset wallet permanently deletes all keys and settings on this device. Export a backup first if you want to keep them.",
                    color = Fog,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                )
                Spacer(Modifier.height(12.dp))
                DangerButton(
                    "Reset Wallet",
                    onClick = { showResetWalletConfirm = true },
                    icon = Icons.Default.Refresh,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(8.dp))
        }
    }

    if (showResetWalletConfirm) {
        RetroDialog(
            onDismissRequest = { showResetWalletConfirm = false },
            title = "Reset Wallet?",
            titleColor = Alarm,
            text = {
                Text(
                    "All keys on this device will be permanently deleted. This cannot be undone.",
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                DialogButton(
                    "Reset",
                    onClick = {
                        showResetWalletConfirm = false
                        wallet.resetWallet()
                    },
                    color = Alarm,
                )
            },
            dismissButton = {
                DialogButton("Cancel", onClick = { showResetWalletConfirm = false }, color = Fog)
            },
        )
    }
}

/** A settings group: crypt panel with a mono section label. */
@Composable
internal fun SettingsCard(
    title: String,
    titleColor: Color = Dim,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .panel()
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        SectionLabel(title, color = titleColor)
        Spacer(Modifier.height(10.dp))
        content()
    }
}

/** A tappable row inside a settings group: phosphor icon, title, optional external-link mark. */
@Composable
internal fun SettingsRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit,
    enabled: Boolean = true,
    subtitle: String? = null,
    external: Boolean = false,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (enabled) Phosphor else Dim, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = if (enabled) Bone else Dim)
            if (subtitle != null) Text(subtitle, color = Dim, fontSize = 12.sp)
        }
        if (external) {
            Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = Dim, modifier = Modifier.size(16.dp))
        }
    }
}

/**
 * Debug-only card that runs the TranslationEngine self-test against the
 * bundled mobile.js. Tap the button → engine warms up, runs the round-trip
 * smoke test from TranslationEngine.runSelfTest(), shows the multi-line
 * report inline. Useful for verifying the bundle loads on a fresh install
 * before bothering with the full instrumented test run.
 */
@Composable
private fun TranslationDebugCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }

    SettingsCard(title = "Translation Engine (debug)") {
        Text(
            "Verify the @byoky/core JS bundle loads in JavaScriptSandbox and round-trips a real translation.",
            color = Fog,
            fontSize = 13.sp,
        )
        Spacer(Modifier.height(4.dp))
        SettingsRow(
            icon = Icons.Default.PlayArrow,
            title = if (running) "Running self-test…" else "Run self-test",
            onClick = {
                if (running) return@SettingsRow
                running = true
                report = "Running…"
                scope.launch {
                    val result = withContext(Dispatchers.IO) {
                        TranslationEngine.get(context).runSelfTest()
                    }
                    report = result
                    running = false
                }
            },
        )
        report?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                color = Fog,
                style = MonoStyle.copy(fontSize = 11.5.sp, lineHeight = 18.sp),
                modifier = Modifier
                    .fillMaxWidth()
                    .panel(background = Ink)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Fog, fontSize = 14.sp)
        Text(value, color = Bone, style = MonoStyle.copy(fontSize = 13.sp))
    }
}
