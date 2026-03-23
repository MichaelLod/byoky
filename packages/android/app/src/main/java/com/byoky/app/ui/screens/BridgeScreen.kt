package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.BridgeStatus
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BridgeScreen(wallet: WalletStore) {
    val bridgeStatus by wallet.bridgeStatus.collectAsState()
    val credentials by wallet.credentials.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Bridge") },
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
            // Status card
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val (statusColor, statusIcon) = when (bridgeStatus) {
                        BridgeStatus.INACTIVE -> TextMuted to Icons.Default.WifiOff
                        BridgeStatus.STARTING -> Accent to Icons.Default.Sync
                        BridgeStatus.ACTIVE -> Success to Icons.Default.CellTower
                        BridgeStatus.ERROR -> Danger to Icons.Default.Warning
                    }

                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(statusColor.copy(alpha = 0.15f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(statusIcon, null, tint = statusColor, modifier = Modifier.size(36.dp))
                    }

                    Spacer(Modifier.height(16.dp))

                    Text(
                        when (bridgeStatus) {
                            BridgeStatus.INACTIVE -> "Bridge inactive"
                            BridgeStatus.STARTING -> "Starting bridge..."
                            BridgeStatus.ACTIVE -> "Bridge active"
                            BridgeStatus.ERROR -> "Bridge error"
                        },
                        fontWeight = FontWeight.SemiBold,
                        color = TextPrimary,
                    )

                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = {
                            if (bridgeStatus == BridgeStatus.ACTIVE) {
                                wallet.setBridgeStatus(BridgeStatus.INACTIVE)
                            } else {
                                wallet.setBridgeStatus(BridgeStatus.STARTING)
                                val proxyService = com.byoky.app.proxy.ProxyService(wallet)
                                val port = proxyService.findAvailablePort()
                                if (port > 0) {
                                    wallet.setBridgeStatus(BridgeStatus.ACTIVE.also { it.port = port })
                                } else {
                                    wallet.setBridgeStatus(BridgeStatus.ERROR.also { it.errorMessage = "Failed to find available port" })
                                }
                            }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (bridgeStatus == BridgeStatus.ACTIVE) Danger else Accent,
                        ),
                    ) {
                        Text(
                            if (bridgeStatus == BridgeStatus.ACTIVE) "Stop Bridge" else "Start Bridge",
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            // Explainer card
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, null, tint = Accent, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("What is the Bridge?", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }

                    Text(
                        "The bridge acts as a local proxy between apps and your API keys. It's needed for:",
                        color = TextSecondary,
                        fontSize = 14.sp,
                    )

                    BridgeFeature(
                        icon = Icons.Default.Key,
                        title = "OAuth Setup Tokens",
                        description = "Requests from a non-browser context to avoid TLS fingerprint detection.",
                    )

                    BridgeFeature(
                        icon = Icons.Default.Cloud,
                        title = "Remote Tools",
                        description = "Tools like OpenClaw on remote servers connect through the relay while the bridge is active.",
                    )

                    HorizontalDivider(color = Border)

                    Text(
                        "The bridge must remain active while using these features. If the app goes to the background, the bridge will pause.",
                        color = TextMuted,
                        fontSize = 12.sp,
                    )
                }
            }

            // Error message
            if (bridgeStatus == BridgeStatus.ERROR) {
                bridgeStatus.errorMessage?.let { msg ->
                    Text(msg, color = Danger, fontSize = 12.sp)
                }
            }

            // Active info
            if (bridgeStatus == BridgeStatus.ACTIVE) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = BgCard),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Text("Connection Info", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        Spacer(Modifier.height(12.dp))
                        InfoRow("Status", "Active")
                        if (bridgeStatus.port > 0) {
                            InfoRow("Port", "${bridgeStatus.port}")
                        }
                        InfoRow("Credentials", "${credentials.size} available")
                    }
                }
            }
        }
    }
}

@Composable
private fun BridgeFeature(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = Accent, modifier = Modifier.size(16.dp).padding(top = 2.dp))
        Column {
            Text(title, fontWeight = FontWeight.Medium, color = TextPrimary, fontSize = 14.sp)
            Text(description, color = TextSecondary, fontSize = 12.sp)
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
