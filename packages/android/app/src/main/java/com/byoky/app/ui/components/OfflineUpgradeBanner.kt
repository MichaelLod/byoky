package com.byoky.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

private const val DISMISS_COOLDOWN_MS = 7L * 24 * 60 * 60 * 1000

@Composable
fun OfflineUpgradeBanner(wallet: WalletStore, onActivate: () -> Unit) {
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val dismissedAt by wallet.vaultBannerDismissedAt.collectAsState()

    val shouldShow = !cloudVaultEnabled && (dismissedAt == 0L || System.currentTimeMillis() - dismissedAt > DISMISS_COOLDOWN_MS)
    if (!shouldShow) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Accent.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
            .border(1.dp, Accent, RoundedCornerShape(10.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Sync across devices",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Turn on Cloud Sync to access your keys on any device, end-to-end encrypted.",
                    fontSize = 12.sp,
                    color = TextSecondary,
                )
            }
            IconButton(onClick = { wallet.dismissVaultBanner() }, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = TextMuted, modifier = Modifier.size(14.dp))
            }
        }

        Spacer(Modifier.height(8.dp))

        Button(
            onClick = onActivate,
            shape = RoundedCornerShape(6.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
        ) {
            Text("Activate Cloud Sync", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
