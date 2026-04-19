package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.relay.PairPayload
import com.byoky.app.relay.PairStatus
import com.byoky.app.relay.RelayPairService
import com.byoky.app.ui.components.QRScannerDialog
import com.byoky.app.ui.theme.*

@Composable
fun PairContent(wallet: WalletStore, pairService: RelayPairService) {
    val status by pairService.status.collectAsState()
    val requestCount by pairService.requestCount.collectAsState()
    val credentials by wallet.credentials.collectAsState()
    val pendingPairLink by wallet.pendingPairLink.collectAsState()
    var showScanner by remember { mutableStateOf(false) }
    var manualCode by remember { mutableStateOf("") }

    LaunchedEffect(pendingPairLink) {
        val link = pendingPairLink ?: return@LaunchedEffect
        connectWithCode(link, pairService, wallet)
        wallet.setPendingPairLink(null)
    }

    Box {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            when (status) {
                PairStatus.IDLE -> IdleContent(
                    manualCode = manualCode,
                    onManualCodeChange = { manualCode = it },
                    onScanClick = { showScanner = true },
                    onConnect = {
                        connectWithCode(it, pairService, wallet)
                    },
                )
                PairStatus.CONNECTING -> ConnectingContent()
                PairStatus.PAIRED -> PairedContent(
                    appOrigin = status.appOrigin ?: "",
                    requestCount = requestCount,
                    credentialCount = credentials.size,
                    onDisconnect = { pairService.disconnect() },
                )
                PairStatus.ERROR -> ErrorContent(
                    message = status.errorMessage ?: "Unknown error",
                    onRetry = { pairService.disconnect() },
                )
            }
        }

        if (showScanner) {
            QRScannerDialog(
                onCode = { code ->
                    showScanner = false
                    connectWithCode(code, pairService, wallet)
                },
                onDismiss = { showScanner = false },
            )
        }
    }
}

private fun connectWithCode(code: String, pairService: RelayPairService, wallet: WalletStore) {
    val cleaned = stripPairLinkPrefix(code.trim())
    val payload = PairPayload.decode(cleaned)
    if (payload == null) {
        pairService.disconnect()
        return
    }
    pairService.connect(payload, wallet)
}

private fun stripPairLinkPrefix(link: String): String {
    return when {
        link.startsWith("byoky://pair/") -> link.removePrefix("byoky://pair/")
        link.startsWith("https://byoky.com/pair#") -> link.removePrefix("https://byoky.com/pair#")
        link.startsWith("https://byoky.com/pair/") -> link.removePrefix("https://byoky.com/pair/")
        else -> link
    }
}

@Composable
private fun IdleContent(
    manualCode: String,
    onManualCodeChange: (String) -> Unit,
    onScanClick: () -> Unit,
    onConnect: (String) -> Unit,
) {
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
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(AccentSoft),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.QrCodeScanner, null, tint = Accent, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Pair with Web App", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(8.dp))

            Text(
                "Scan the QR code shown on the web app, or paste the pairing code below. Your phone becomes the wallet \u2014 keys never leave this device. Keep the app open while using the web app.",
                color = TextSecondary,
                textAlign = TextAlign.Center,
                fontSize = 14.sp,
            )

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = onScanClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Icon(Icons.Default.CameraAlt, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Scan QR Code", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    Spacer(Modifier.height(16.dp))

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
        ) {
            Text("Manual Entry", fontWeight = FontWeight.SemiBold, color = TextSecondary, fontSize = 12.sp)

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = manualCode,
                onValueChange = onManualCodeChange,
                placeholder = { Text("Paste pairing code") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Border,
                    focusedContainerColor = BgRaised,
                    unfocusedContainerColor = BgRaised,
                ),
                shape = RoundedCornerShape(12.dp),
            )

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = { onConnect(manualCode) },
                enabled = manualCode.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text("Connect")
            }

            Spacer(Modifier.height(8.dp))

            Text(
                "Copy the pairing code from the web app and paste it here.",
                color = TextMuted,
                fontSize = 12.sp,
            )
        }
    }
}

@Composable
private fun ColumnScope.ConnectingContent() {
    Spacer(Modifier.weight(1f))

    CircularProgressIndicator(color = Accent, modifier = Modifier.size(48.dp).align(Alignment.CenterHorizontally))

    Spacer(Modifier.height(16.dp))

    Text("Connecting to web app...", color = TextSecondary, modifier = Modifier.align(Alignment.CenterHorizontally))

    Spacer(Modifier.weight(1f))
}

@Composable
private fun PairedContent(
    appOrigin: String,
    requestCount: Int,
    credentialCount: Int,
    onDisconnect: () -> Unit,
) {
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
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(Success.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.CheckCircle, null, tint = Success, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Connected", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(4.dp))

            Text(appOrigin, color = TextSecondary, fontSize = 14.sp)
        }
    }

    Spacer(Modifier.height(16.dp))

    // Keep app open warning
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(Icons.Default.Warning, null, tint = Warning, modifier = Modifier.size(24.dp))
            Column {
                Text("Keep this app open", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 14.sp)
                Spacer(Modifier.height(4.dp))
                Text(
                    "API calls are proxied through your phone. Locking your phone or switching apps will pause the connection.",
                    color = TextSecondary,
                    fontSize = 12.sp,
                )
            }
        }
    }

    Spacer(Modifier.height(16.dp))

    // Stats
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            InfoRow("Requests proxied", "$requestCount")
            InfoRow("Credentials available", "$credentialCount")
        }
    }

    Spacer(Modifier.height(16.dp))

    Button(
        onClick = onDisconnect,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Danger),
    ) {
        Icon(Icons.Default.Close, null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Disconnect", fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ColumnScope.ErrorContent(message: String, onRetry: () -> Unit) {
    Spacer(Modifier.weight(1f))

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
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(CircleShape)
                    .background(Warning.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Warning, null, tint = Warning, modifier = Modifier.size(36.dp))
            }

            Spacer(Modifier.height(16.dp))

            Text("Connection Failed", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 18.sp)

            Spacer(Modifier.height(8.dp))

            Text(message, color = TextSecondary, textAlign = TextAlign.Center, fontSize = 14.sp)

            Spacer(Modifier.height(20.dp))

            Button(
                onClick = onRetry,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Text("Try Again", fontWeight = FontWeight.SemiBold)
            }
        }
    }

    Spacer(Modifier.weight(1f))
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

