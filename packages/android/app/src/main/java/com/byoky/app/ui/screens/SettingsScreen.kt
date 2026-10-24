package com.byoky.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.BuildConfig
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.TranslationEngine
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(wallet: WalletStore) {
    val context = LocalContext.current
    var showResetWalletConfirm by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Security
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("Security", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    Spacer(Modifier.height(16.dp))

                    Surface(
                        onClick = { wallet.lock() },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Lock, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("Lock Wallet", color = TextPrimary)
                        }
                    }

                    Spacer(Modifier.height(12.dp))

                    InfoRow("Encryption", "AES-256-GCM")
                    InfoRow("Key Derivation", "PBKDF2 (600K)")
                    InfoRow("Storage", "On this device only")
                }
            }

            BackupSection(wallet)

            // Translation engine debug — only shown in debug builds.
            if (BuildConfig.DEBUG) {
                TranslationDebugCard()
            }

            // About
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("About", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    Spacer(Modifier.height(16.dp))

                    InfoRow("Version", BuildConfig.VERSION_NAME)

                    Spacer(Modifier.height(8.dp))

                    Surface(
                        onClick = {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/MichaelLod/byoky"))
                            )
                        },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Code, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("GitHub", color = TextPrimary)
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        }
                    }

                    Spacer(Modifier.height(4.dp))

                    Surface(
                        onClick = {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://byoky.com"))
                            )
                        },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Language, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("Website", color = TextPrimary)
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }

            // Danger Zone
            Card(
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = BgCard),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Danger Zone", color = Danger, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Reset wallet permanently deletes all keys and settings on this device. Export a backup first if you want to keep them.",
                        color = TextMuted,
                        fontSize = 11.sp,
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = { showResetWalletConfirm = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger),
                    ) {
                        Icon(Icons.Default.Refresh, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Reset Wallet")
                    }
                }
            }
        }
    }

    if (showResetWalletConfirm) {
        AlertDialog(
            onDismissRequest = { showResetWalletConfirm = false },
            containerColor = BgCard,
            title = { Text("Reset Wallet?", color = Danger) },
            text = {
                Text(
                    "All keys on this device will be permanently deleted. This cannot be undone.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showResetWalletConfirm = false
                        wallet.resetWallet()
                    },
                ) { Text("Reset", color = Danger) }
            },
            dismissButton = {
                TextButton(onClick = { showResetWalletConfirm = false }) { Text("Cancel") }
            },
        )
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

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.BugReport, null, tint = Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text("Translation Engine (debug)", fontWeight = FontWeight.SemiBold, color = TextPrimary)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Verify the @byoky/core JS bundle loads in JavaScriptSandbox and round-trips a real translation.",
                color = TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))
            Surface(
                onClick = {
                    if (running) return@Surface
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
                color = BgCard,
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.PlayArrow, null, tint = Accent, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(if (running) "Running self-test…" else "Run self-test", color = TextPrimary)
                }
            }
            report?.let {
                Spacer(Modifier.height(12.dp))
                Text(
                    it,
                    color = TextSecondary,
                    fontSize = 12.sp,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                )
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp)
        Text(value, color = TextPrimary, fontSize = 14.sp)
    }
}
