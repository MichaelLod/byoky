package com.byoky.app.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

/**
 * One-time notice after this phone set aside a wallet it couldn't read (one
 * copied from another device, whose keystore key stayed behind, or one the
 * user gave up on when the Keystore wouldn't open it) and started fresh.
 * Renders nothing otherwise. Like [RetiredFeaturesNotice] it shows on
 * one launch only: marked seen as soon as it appears, it stays up for that
 * session until dismissed.
 */
@Composable
fun UnreadableVaultNotice(
    wallet: WalletStore,
    modifier: Modifier = Modifier,
    onOpenSettings: (() -> Unit)? = null,
) {
    val visible by wallet.unreadableVaultNotice.collectAsState()
    LaunchedEffect(visible) {
        if (visible) wallet.markUnreadableVaultNoticeShown()
    }
    if (!visible) return

    Row(
        modifier = modifier
            .fillMaxWidth()
            .panel(background = VioletSoft, border = Violet)
            .padding(start = 14.dp, top = 12.dp, bottom = 4.dp, end = 6.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            CapsText(
                "A new wallet on this phone",
                style = HeadingStyle.copy(fontSize = 14.sp),
                color = Bone,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "This phone couldn't read its saved wallet (one copied from another device, or one its secure storage won't open), so Byoky started fresh. Restore your keys from a .byoky backup with Import backup in Settings.",
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = Fog,
            )
            if (onOpenSettings != null) {
                BracketAction(
                    "Open Settings",
                    onClick = onOpenSettings,
                    modifier = Modifier.offset(x = (-12).dp),
                )
            } else {
                Spacer(Modifier.height(8.dp))
            }
        }
        IconButton(onClick = { wallet.dismissUnreadableVaultNotice() }, modifier = Modifier.size(32.dp)) {
            Icon(Icons.Default.Close, contentDescription = "Dismiss", tint = Fog, modifier = Modifier.size(16.dp))
        }
    }
}
