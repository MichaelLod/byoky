package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.Credential
import com.byoky.app.data.Gift
import com.byoky.app.data.GiftedCredential
import com.byoky.app.data.Provider
import com.byoky.app.data.RequestLog
import com.byoky.app.data.formatTokens
import com.byoky.app.data.giftBudgetPercent
import com.byoky.app.data.giftBudgetRemaining
import com.byoky.app.ui.theme.*

sealed class WalletStatsTarget {
    data class Credential(val credentialId: String) : WalletStatsTarget()
    data class Gift(val giftedCredentialId: String) : WalletStatsTarget()
}

private enum class StatsRange(val label: String, val millis: Long?) {
    DAY("24h", 86_400_000L),
    WEEK("7d", 604_800_000L),
    MONTH("30d", 2_592_000_000L),
    ALL("All", null),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletStatsSheet(
    target: WalletStatsTarget,
    credentials: List<Credential>,
    gifts: List<Gift>,
    giftedCredentials: List<GiftedCredential>,
    requestLogs: List<RequestLog>,
    giftPeerOnline: Map<String, Boolean>,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BgRaised,
    ) {
        when (target) {
            is WalletStatsTarget.Credential -> {
                val cred = credentials.firstOrNull { it.id == target.credentialId }
                if (cred == null) MissingStats()
                else CredentialStatsContent(
                    credential = cred,
                    gifts = gifts.filter { it.credentialId == cred.id },
                    requestLogs = requestLogs,
                )
            }
            is WalletStatsTarget.Gift -> {
                val gc = giftedCredentials.firstOrNull { it.id == target.giftedCredentialId }
                if (gc == null) MissingStats()
                else GiftStatsContent(
                    credential = gc,
                    online = giftPeerOnline[gc.giftId],
                )
            }
        }
    }
}

@Composable
private fun MissingStats() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("No data", color = TextSecondary)
    }
}

@Composable
private fun CredentialStatsContent(
    credential: Credential,
    gifts: List<Gift>,
    requestLogs: List<RequestLog>,
) {
    val provider = Provider.find(credential.providerId)
    var range by remember { mutableStateOf(StatsRange.WEEK) }

    val filtered = remember(requestLogs, range, credential.providerId) {
        val now = System.currentTimeMillis()
        val cutoff = range.millis?.let { now - it }
        requestLogs.filter {
            it.providerId == credential.providerId &&
                it.statusCode < 400 &&
                (cutoff == null || it.timestamp > cutoff)
        }
    }

    val totalInput = filtered.sumOf { it.inputTokens ?: 0 }
    val totalOutput = filtered.sumOf { it.outputTokens ?: 0 }

    data class ModelRow(val model: String, val requests: Int, val total: Int)
    data class AppRow(val origin: String, val requests: Int, val total: Int)

    val byModel = remember(filtered) {
        val map = mutableMapOf<String, IntArray>() // [requests, tokens]
        for (e in filtered) {
            val model = e.model ?: continue
            val arr = map.getOrPut(model) { IntArray(2) }
            arr[0] += 1
            arr[1] += (e.inputTokens ?: 0) + (e.outputTokens ?: 0)
        }
        map.map { ModelRow(it.key, it.value[0], it.value[1]) }.sortedByDescending { it.total }
    }

    val byApp = remember(filtered) {
        val map = mutableMapOf<String, IntArray>() // [requests, tokens]
        for (e in filtered) {
            val arr = map.getOrPut(e.appOrigin) { IntArray(2) }
            arr[0] += 1
            arr[1] += (e.inputTokens ?: 0) + (e.outputTokens ?: 0)
        }
        map.map { AppRow(it.key, it.value[0], it.value[1]) }.sortedByDescending { it.total }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column {
            Text(
                credential.label,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )
            Text(
                "${provider?.name ?: credential.providerId} · shared across credentials of this provider",
                fontSize = 12.sp,
                color = TextSecondary,
            )
        }

        RangePicker(selected = range, onSelect = { range = it })

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatCell("Requests", "${filtered.size}", Modifier.weight(1f))
            StatCell("Input", formatTokens(totalInput), Modifier.weight(1f))
            StatCell("Output", formatTokens(totalOutput), Modifier.weight(1f))
        }

        if (filtered.isEmpty()) {
            Text(
                "No usage in this period.",
                color = TextSecondary,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (byModel.isNotEmpty()) {
            SectionCard(title = "By Model") {
                byModel.forEach { row ->
                    KeyValueRow(
                        title = row.model,
                        subtitle = "${row.requests} request${if (row.requests == 1) "" else "s"}",
                        value = "${formatTokens(row.total)} tokens",
                    )
                }
            }
        }

        if (byApp.isNotEmpty()) {
            SectionCard(title = "By App") {
                byApp.forEach { row ->
                    KeyValueRow(
                        title = hostnameOf(row.origin),
                        subtitle = "${row.requests} request${if (row.requests == 1) "" else "s"}",
                        value = "${formatTokens(row.total)} tokens",
                    )
                }
            }
        }

        SectionCard(title = "Gifts from this credential") {
            if (gifts.isEmpty()) {
                Text(
                    "No gifts created from this credential.",
                    fontSize = 12.sp,
                    color = TextSecondary,
                    modifier = Modifier.padding(vertical = 4.dp),
                )
            } else {
                val totalRedeemed = gifts.sumOf { it.usedTokens }
                Text(
                    "${formatTokens(totalRedeemed)} tokens redeemed across ${gifts.size} gift${if (gifts.size == 1) "" else "s"}",
                    fontSize = 12.sp,
                    color = TextSecondary,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
                gifts.forEach { g ->
                    GiftSummaryRow(gift = g)
                }
            }
        }
    }
}

@Composable
private fun GiftStatsContent(
    credential: GiftedCredential,
    online: Boolean?,
) {
    val provider = Provider.find(credential.providerId)
    val remaining = giftBudgetRemaining(credential.usedTokens, credential.maxTokens)
    val percent = giftBudgetPercent(credential.usedTokens, credential.maxTokens)
    val statusText = when (online) {
        true -> "Online"
        false -> "Offline"
        null -> "Checking…"
    }
    val statusColor = when (online) {
        true -> Color(0xFF34D399)
        false -> Color(0xFFF43F5E)
        null -> Color(0xFFF59E0B)
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column {
            Text(
                "Gift from ${credential.senderLabel}",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )
            Text(
                provider?.name ?: credential.providerId,
                fontSize = 12.sp,
                color = TextSecondary,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatCell("Used", formatTokens(credential.usedTokens), Modifier.weight(1f))
            StatCell("Remaining", formatTokens(remaining), Modifier.weight(1f))
            StatCell("Budget", formatTokens(credential.maxTokens), Modifier.weight(1f))
        }

        LinearProgressIndicator(
            progress = { percent / 100f },
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp)),
            color = if (percent > 80) Warning else Accent,
            trackColor = BgHover,
        )

        SectionCard(title = null) {
            KeyValueRow(title = "Sender", subtitle = null, value = statusText, valueColor = statusColor)
            HorizontalDivider(color = BgHover)
            KeyValueRow(title = "Expires", subtitle = null, value = giftExpiryText(credential.expiresAt))
            HorizontalDivider(color = BgHover)
            KeyValueRow(title = "Received", subtitle = null, value = formatAbsoluteDate(credential.createdAt))
        }
    }
}

@Composable
private fun RangePicker(selected: StatsRange, onSelect: (StatsRange) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(BgCard),
    ) {
        StatsRange.entries.forEach { r ->
            val isSelected = r == selected
            Surface(
                onClick = { onSelect(r) },
                modifier = Modifier.weight(1f),
                color = if (isSelected) Accent else BgCard,
                shape = RoundedCornerShape(10.dp),
            ) {
                Text(
                    r.label,
                    modifier = Modifier.padding(vertical = 8.dp),
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = if (isSelected) TextPrimary else TextSecondary,
                )
            }
        }
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = TextPrimary)
            Spacer(Modifier.height(4.dp))
            Text(label, color = TextSecondary, fontSize = 11.sp)
        }
    }
}

@Composable
private fun SectionCard(title: String?, content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            if (title != null) {
                Text(title, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Spacer(Modifier.height(8.dp))
            }
            content()
        }
    }
}

@Composable
private fun KeyValueRow(
    title: String,
    subtitle: String?,
    value: String,
    valueColor: Color = TextPrimary,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontSize = 13.sp,
                color = TextPrimary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(subtitle, fontSize = 11.sp, color = TextSecondary)
            }
        }
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = valueColor)
    }
}

@Composable
private fun GiftSummaryRow(gift: Gift) {
    val percent = giftBudgetPercent(gift.usedTokens, gift.maxTokens)
    val active = gift.active && System.currentTimeMillis() < gift.expiresAt
    Column(modifier = Modifier.padding(vertical = 6.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                gift.label.ifEmpty { "Unnamed gift" },
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = TextPrimary,
            )
            Text(
                if (!active) "Inactive" else giftExpiryText(gift.expiresAt),
                fontSize = 11.sp,
                color = TextSecondary,
            )
        }
        Spacer(Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { percent / 100f },
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp)),
            color = if (percent > 80) Warning else Accent,
            trackColor = BgHover,
        )
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("${formatTokens(gift.usedTokens)} used", fontSize = 11.sp, color = TextSecondary)
            Text("/ ${formatTokens(gift.maxTokens)}", fontSize = 11.sp, color = TextSecondary)
        }
    }
}

private fun giftExpiryText(expiresAt: Long): String {
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

private fun formatAbsoluteDate(ms: Long): String {
    val fmt = java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale.getDefault())
    return fmt.format(java.util.Date(ms))
}

private fun hostnameOf(origin: String): String =
    try {
        java.net.URI(origin).host ?: origin
    } catch (_: Exception) {
        origin
    }
