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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.Credential
import com.byoky.app.data.Provider
import com.byoky.app.data.RequestLog
import com.byoky.app.data.formatTokens
import com.byoky.app.ui.theme.*

private enum class StatsRange(val label: String, val millis: Long?) {
    DAY("24h", 86_400_000L),
    WEEK("7d", 604_800_000L),
    MONTH("30d", 2_592_000_000L),
    ALL("All", null),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletStatsSheet(
    credentialId: String,
    credentials: List<Credential>,
    requestLogs: List<RequestLog>,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BgRaised,
    ) {
        val cred = credentials.firstOrNull { it.id == credentialId }
        if (cred == null) MissingStats()
        else CredentialStatsContent(credential = cred, requestLogs = requestLogs)
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
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, color = TextPrimary)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun KeyValueRow(
    title: String,
    subtitle: String?,
    value: String,
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
        Text(value, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = TextPrimary)
    }
}

private fun hostnameOf(origin: String): String =
    try {
        java.net.URI(origin).host ?: origin
    } catch (_: Exception) {
        origin
    }
