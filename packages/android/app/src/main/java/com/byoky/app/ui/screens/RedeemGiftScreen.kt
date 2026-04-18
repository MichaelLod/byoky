package com.byoky.app.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.*
import com.byoky.app.ui.components.QRScannerDialog
import com.byoky.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RedeemGiftScreen(wallet: WalletStore, onBack: () -> Unit) {
    val pendingGiftLink by wallet.pendingGiftLink.collectAsState()
    var linkText by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var redeemed by remember { mutableStateOf(false) }
    var showScanner by remember { mutableStateOf(false) }

    LaunchedEffect(pendingGiftLink) {
        val link = pendingGiftLink ?: return@LaunchedEffect
        linkText = link
        wallet.setPendingGiftLink(null)
    }

    val rawPayload = remember(linkText) {
        val trimmed = linkText.trim()
        when {
            trimmed.startsWith("https://byoky.com/gift#") -> trimmed.removePrefix("https://byoky.com/gift#")
            trimmed.startsWith("https://byoky.com/gift/") -> trimmed.removePrefix("https://byoky.com/gift/")
            trimmed.startsWith("byoky://gift/") -> trimmed.removePrefix("byoky://gift/")
            else -> trimmed
        }
    }

    val preview = remember(rawPayload) {
        if (rawPayload.isBlank()) null else decodeGiftLink(rawPayload)
    }

    val validation = remember(preview) {
        if (preview != null) validateGiftLink(preview) else null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Redeem Gift") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = TextPrimary)
                    }
                },
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
            if (redeemed) {
                RedeemedState(preview!!, onBack)
            } else {
                OutlinedButton(
                    onClick = { showScanner = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
                ) {
                    Icon(Icons.Default.QrCodeScanner, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Scan QR Code", fontWeight = FontWeight.SemiBold)
                }

                Text("Gift Link", color = TextSecondary, fontSize = 12.sp)
                OutlinedTextField(
                    value = linkText,
                    onValueChange = {
                        linkText = it
                        error = null
                    },
                    placeholder = { Text("Paste gift link") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 120.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Border,
                        focusedContainerColor = BgCard,
                        unfocusedContainerColor = BgCard,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    maxLines = 5,
                )

                if (rawPayload.isNotBlank() && preview == null) {
                    Text("Could not decode gift link", color = Danger, fontSize = 12.sp)
                }

                if (preview != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = BgCard),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text("Gift Preview", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                            Spacer(Modifier.height(8.dp))
                            PreviewRow("Provider", preview.n)
                            PreviewRow("From", preview.s)
                            PreviewRow("Budget", "${formatTokens(preview.m)} tokens")
                            PreviewRow("Relay", preview.r)

                            val expired = isGiftExpired(preview.e)
                            PreviewRow(
                                "Expires",
                                if (expired) "Expired" else formatRedeemExpiry(preview.e),
                                valueColor = if (expired) Danger else TextPrimary,
                            )
                        }
                    }

                    if (validation != null && !validation.first) {
                        Text(validation.second ?: "Invalid gift", color = Danger, fontSize = 12.sp)
                    }
                }

                error?.let {
                    Text(it, color = Danger, fontSize = 12.sp)
                }

                Spacer(Modifier.height(8.dp))

                Button(
                    onClick = {
                        val (success, err) = wallet.redeemGift(rawPayload)
                        if (success) {
                            redeemed = true
                        } else {
                            error = err
                        }
                    },
                    enabled = preview != null && (validation?.first == true),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Accent,
                        disabledContainerColor = Accent.copy(alpha = 0.3f),
                    ),
                ) {
                    Text("Accept Gift", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    if (showScanner) {
        QRScannerDialog(
            title = "Scan Gift QR",
            onCode = { code ->
                showScanner = false
                linkText = code
                error = null
            },
            onDismiss = { showScanner = false },
        )
    }
}

@Composable
private fun RedeemedState(link: GiftLink, onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(32.dp))

        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = Success,
            modifier = Modifier.size(48.dp),
        )

        Text(
            "Gift Redeemed!",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )

        Text(
            "You received ${formatTokens(link.m)} tokens of ${link.n} from ${link.s}.",
            color = TextSecondary,
            fontSize = 14.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = onBack,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            Text("Done", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun PreviewRow(
    label: String,
    value: String,
    valueColor: androidx.compose.ui.graphics.Color = TextPrimary,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = TextSecondary, fontSize = 13.sp)
        Text(value, color = valueColor, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

private fun formatRedeemExpiry(expiresAt: Long): String {
    val remaining = expiresAt - System.currentTimeMillis()
    if (remaining <= 0) return "Expired"
    val hours = remaining / 3_600_000
    val days = hours / 24
    return when {
        days > 0 -> "in ${days} day${if (days == 1L) "" else "s"}"
        hours > 0 -> "in ${hours} hour${if (hours == 1L) "" else "s"}"
        else -> "in ${remaining / 60_000} min"
    }
}
