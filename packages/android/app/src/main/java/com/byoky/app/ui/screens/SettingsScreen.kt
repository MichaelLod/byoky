package com.byoky.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(wallet: WalletStore) {
    val context = LocalContext.current

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
            // Firefox Extension
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Extension, null, tint = Accent, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("Firefox Extension", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Install the Byoky extension for Firefox on Android to proxy requests from websites. Chrome on Android doesn't support extensions.",
                        color = TextSecondary,
                        fontSize = 14.sp,
                    )
                }
            }

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
                    InfoRow("Storage", "EncryptedSharedPreferences")
                }
            }

            // About
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("About", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    Spacer(Modifier.height(16.dp))

                    InfoRow("Version", "1.0.0")

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
                            Icon(Icons.Default.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
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
                            Icon(Icons.Default.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        }
                    }
                }
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
