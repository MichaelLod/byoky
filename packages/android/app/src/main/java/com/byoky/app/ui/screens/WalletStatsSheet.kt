package com.byoky.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.byoky.app.data.Credential
import com.byoky.app.data.Provider
import com.byoky.app.data.RequestLog
import com.byoky.app.data.formatTokens
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.RetroBottomSheet
import com.byoky.app.ui.components.SectionLabel
import com.byoky.app.ui.components.panel
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
    RetroBottomSheet(onDismissRequest = onDismiss) {
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
        Text("No data", color = Fog)
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
            CapsText(
                credential.label,
                style = HeadingStyle.copy(fontSize = 22.sp, lineHeight = 28.sp),
                color = Bone,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "${provider?.name ?: credential.providerId} · shared across credentials of this provider",
                fontSize = 12.sp,
                color = Fog,
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
                color = Fog,
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
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        StatsRange.entries.forEach { r ->
            val isSelected = r == selected
            Surface(
                selected = isSelected,
                onClick = { onSelect(r) },
                modifier = Modifier.weight(1f),
                color = if (isSelected) Violet else Color.Transparent,
                shape = RectangleShape,
                border = BorderStroke(1.dp, if (isSelected) Violet else SeamStrong),
            ) {
                CapsText(
                    r.label,
                    modifier = Modifier.padding(vertical = 9.dp),
                    textAlign = TextAlign.Center,
                    style = MonoLabelStyle.copy(fontSize = 13.sp, letterSpacing = 0.08.em),
                    color = if (isSelected) Color.White else Fog,
                )
            }
        }
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .panel(background = Ash)
            .padding(vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, style = MonoStyle.copy(fontSize = 18.sp, lineHeight = 24.sp), fontWeight = FontWeight.Medium, color = Bone)
        Spacer(Modifier.height(4.dp))
        SectionLabel(label)
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .panel(background = Ash)
            .padding(14.dp),
    ) {
        SectionLabel(title)
        Spacer(Modifier.height(6.dp))
        content()
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
                style = MonoStyle.copy(fontSize = 13.sp, lineHeight = 18.sp),
                color = Bone,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Text(subtitle, style = MonoStyle.copy(fontSize = 11.sp), color = Dim)
            }
        }
        Text(value, style = MonoStyle.copy(fontSize = 13.sp), fontWeight = FontWeight.Medium, color = Bone)
    }
}

private fun hostnameOf(origin: String): String =
    try {
        java.net.URI(origin).host ?: origin
    } catch (_: Exception) {
        origin
    }
