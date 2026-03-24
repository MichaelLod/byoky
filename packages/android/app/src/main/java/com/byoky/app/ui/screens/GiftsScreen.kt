package com.byoky.app.ui.screens

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.*
import com.byoky.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GiftsScreen(
    wallet: WalletStore,
    onNavigateToCreate: () -> Unit,
    onNavigateToRedeem: () -> Unit,
) {
    val gifts by wallet.gifts.collectAsState()
    val giftedCredentials by wallet.giftedCredentials.collectAsState()

    val activeGifts = remember(gifts) { gifts.filter { it.active && !isGiftExpired(it.expiresAt) } }
    val activeReceived = remember(giftedCredentials) { giftedCredentials.filter { !isGiftExpired(it.expiresAt) } }
    val inactiveGifts = remember(gifts) { gifts.filter { !it.active || isGiftExpired(it.expiresAt) } }
    val expiredReceived = remember(giftedCredentials) { giftedCredentials.filter { isGiftExpired(it.expiresAt) } }

    val isEmpty = gifts.isEmpty() && giftedCredentials.isEmpty()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Gifts") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        if (isEmpty) {
            EmptyGifts(
                modifier = Modifier.padding(padding),
                onCreateGift = onNavigateToCreate,
                onRedeemGift = onNavigateToRedeem,
            )
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = onNavigateToCreate,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Accent),
                        ) {
                            Icon(Icons.Default.Add, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Create Gift")
                        }
                        OutlinedButton(
                            onClick = onNavigateToRedeem,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
                        ) {
                            Icon(Icons.Default.Redeem, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Redeem Gift")
                        }
                    }
                }

                if (activeGifts.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(8.dp))
                        Text("Sent", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }
                    items(activeGifts, key = { it.id }) { gift ->
                        SentGiftCard(gift, wallet)
                    }
                }

                if (activeReceived.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(8.dp))
                        Text("Received", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }
                    items(activeReceived, key = { it.id }) { gc ->
                        ReceivedGiftCard(gc) { wallet.removeGiftedCredential(gc.id) }
                    }
                }

                if (inactiveGifts.isNotEmpty() || expiredReceived.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(8.dp))
                        Text("Expired / Revoked", fontWeight = FontWeight.SemiBold, color = TextMuted)
                    }
                    items(inactiveGifts, key = { "sent-${it.id}" }) { gift ->
                        SentGiftCard(gift, wallet, dimmed = true)
                    }
                    items(expiredReceived, key = { "recv-${it.id}" }) { gc ->
                        ReceivedGiftCard(gc, dimmed = true) { wallet.removeGiftedCredential(gc.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyGifts(modifier: Modifier, onCreateGift: () -> Unit, onRedeemGift: () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Default.CardGiftcard,
            contentDescription = null,
            tint = TextMuted,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text("No Gifts", fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Spacer(Modifier.height(8.dp))
        Text(
            "Share token access without sharing your API keys. Create a gift link or redeem one you received.",
            color = TextSecondary,
            textAlign = TextAlign.Center,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onCreateGift,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            Icon(Icons.Default.Add, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Create Gift")
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = onRedeemGift,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
        ) {
            Icon(Icons.Default.Redeem, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Redeem Gift")
        }
    }
}

@Composable
private fun SentGiftCard(gift: Gift, wallet: WalletStore, dimmed: Boolean = false) {
    val context = LocalContext.current
    val provider = Provider.find(gift.providerId)
    val remaining = giftBudgetRemaining(gift.usedTokens, gift.maxTokens)
    val percent = giftBudgetPercent(gift.usedTokens, gift.maxTokens)
    val expired = isGiftExpired(gift.expiresAt)
    val alpha = if (dimmed) 0.5f else 1f

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard.copy(alpha = alpha)),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        provider?.name ?: gift.providerId,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary.copy(alpha = alpha),
                    )
                    Text(
                        gift.label,
                        fontSize = 12.sp,
                        color = TextSecondary.copy(alpha = alpha),
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${formatTokens(remaining)} left",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = TextPrimary.copy(alpha = alpha),
                    )
                    Text(
                        if (expired) "Expired" else formatExpiry(gift.expiresAt),
                        fontSize = 11.sp,
                        color = if (expired) Danger.copy(alpha = alpha) else TextMuted.copy(alpha = alpha),
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            LinearProgressIndicator(
                progress = { percent / 100f },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp)),
                color = if (percent > 80) Warning else Accent,
                trackColor = BgHover,
            )

            if (!dimmed) {
                Spacer(Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = {
                        val (encoded, _) = createGiftLink(gift)
                        val url = giftLinkToUrl(encoded)
                        val shareText = "I'm sharing ${formatTokens(gift.maxTokens)} tokens of ${provider?.name ?: gift.providerId} via Byoky! $url"
                        val intent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, shareText)
                        }
                        context.startActivity(Intent.createChooser(intent, "Share Gift"))
                    }) {
                        Icon(Icons.Default.Share, null, modifier = Modifier.size(16.dp), tint = Accent)
                        Spacer(Modifier.width(4.dp))
                        Text("Share", color = Accent, fontSize = 13.sp)
                    }
                    TextButton(onClick = { wallet.revokeGift(gift.id) }) {
                        Icon(Icons.Default.Close, null, modifier = Modifier.size(16.dp), tint = Danger)
                        Spacer(Modifier.width(4.dp))
                        Text("Revoke", color = Danger, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ReceivedGiftCard(
    gc: GiftedCredential,
    dimmed: Boolean = false,
    onRemove: () -> Unit,
) {
    val remaining = giftBudgetRemaining(gc.usedTokens, gc.maxTokens)
    val percent = giftBudgetPercent(gc.usedTokens, gc.maxTokens)
    val expired = isGiftExpired(gc.expiresAt)
    val alpha = if (dimmed) 0.5f else 1f

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard.copy(alpha = alpha)),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        gc.providerName,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary.copy(alpha = alpha),
                    )
                    Text(
                        "From: ${gc.senderLabel}",
                        fontSize = 12.sp,
                        color = TextSecondary.copy(alpha = alpha),
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${formatTokens(remaining)} left",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        color = TextPrimary.copy(alpha = alpha),
                    )
                    Text(
                        if (expired) "Expired" else formatExpiry(gc.expiresAt),
                        fontSize = 11.sp,
                        color = if (expired) Danger.copy(alpha = alpha) else TextMuted.copy(alpha = alpha),
                    )
                }
            }

            Spacer(Modifier.height(10.dp))

            LinearProgressIndicator(
                progress = { percent / 100f },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp)),
                color = if (percent > 80) Warning else Accent,
                trackColor = BgHover,
            )

            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onRemove) {
                    Icon(Icons.Default.Delete, null, modifier = Modifier.size(16.dp), tint = Danger)
                    Spacer(Modifier.width(4.dp))
                    Text("Remove", color = Danger, fontSize = 13.sp)
                }
            }
        }
    }
}

private fun formatExpiry(expiresAt: Long): String {
    val remaining = expiresAt - System.currentTimeMillis()
    if (remaining <= 0) return "Expired"
    val hours = remaining / 3_600_000
    val days = hours / 24
    return when {
        days > 0 -> "${days}d left"
        hours > 0 -> "${hours}h left"
        else -> "${remaining / 60_000}m left"
    }
}
