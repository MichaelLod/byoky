package com.byoky.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

/**
 * One-time notice for people who used cloud sync, gifts or phone pairing
 * before they were retired. Renders nothing for everyone else. It shows on
 * one launch only: marked seen as soon as it appears, it stays up for that
 * session until dismissed.
 */
@Composable
fun RetiredFeaturesNotice(
    wallet: WalletStore,
    modifier: Modifier = Modifier,
    onOpenSettings: (() -> Unit)? = null,
) {
    val visible by wallet.retiredFeaturesNotice.collectAsState()
    LaunchedEffect(visible) {
        if (visible) wallet.markRetiredFeaturesNoticeShown()
    }
    if (!visible) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(Accent.copy(alpha = 0.08f), RoundedCornerShape(10.dp))
            .border(1.dp, Accent, RoundedCornerShape(10.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "Byoky is now fully local",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Cloud sync, gifts and phone pairing have been retired. Your keys on this device are untouched. To move keys to another device, use Export in Settings.",
                fontSize = 12.sp,
                color = TextSecondary,
            )
            if (onOpenSettings != null) {
                TextButton(
                    onClick = onOpenSettings,
                    contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                ) {
                    Text("Open Settings", fontSize = 12.sp, color = Accent, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        IconButton(onClick = { wallet.dismissRetiredFeaturesNotice() }, modifier = Modifier.size(24.dp)) {
            Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = TextMuted, modifier = Modifier.size(14.dp))
        }
    }
}
