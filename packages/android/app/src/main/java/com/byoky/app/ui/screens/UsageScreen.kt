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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.Provider
import com.byoky.app.data.RequestLog
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

private enum class TimeRange(val label: String, val millis: Long?) {
    DAY("24h", 86_400_000L),
    WEEK("7d", 604_800_000L),
    MONTH("30d", 2_592_000_000L),
    ALL("All", null),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsageScreen(wallet: WalletStore) {
    val requestLogs by wallet.requestLogs.collectAsState()
    var range by remember { mutableStateOf(TimeRange.WEEK) }

    val now = System.currentTimeMillis()
    val filtered = remember(requestLogs, range) {
        val millis = range.millis
        if (millis == null) requestLogs
        else requestLogs.filter { it.timestamp > now - millis }
    }

    val successful = remember(filtered) { filtered.filter { it.statusCode < 400 } }
    val totalInput = remember(successful) { successful.sumOf { it.inputTokens ?: 0 } }
    val totalOutput = remember(successful) { successful.sumOf { it.outputTokens ?: 0 } }

    val byProvider = remember(successful) {
        val map = mutableMapOf<String, Triple<Int, Int, Int>>() // requests, input, output
        for (entry in successful) {
            val prev = map[entry.providerId] ?: Triple(0, 0, 0)
            map[entry.providerId] = Triple(
                prev.first + 1,
                prev.second + (entry.inputTokens ?: 0),
                prev.third + (entry.outputTokens ?: 0),
            )
        }
        map.entries.sortedByDescending { it.value.second + it.value.third }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Usage") },
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
            // Range picker
            RangePicker(selected = range, onSelect = { range = it })

            // Totals
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard("Requests", "${successful.size}", Modifier.weight(1f))
                StatCard("Input tokens", formatTokens(totalInput), Modifier.weight(1f))
                StatCard("Output tokens", formatTokens(totalOutput), Modifier.weight(1f))
            }

            // By provider
            if (byProvider.isNotEmpty()) {
                Text("By Provider", fontWeight = FontWeight.SemiBold, color = TextPrimary)

                byProvider.forEach { (providerId, stats) ->
                    val (requests, input, output) = stats
                    val provider = Provider.find(providerId)
                    val totalTokens = input + output

                    Card(
                        colors = CardDefaults.cardColors(containerColor = BgCard),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column {
                                    Text(
                                        provider?.name ?: providerId,
                                        fontWeight = FontWeight.Medium,
                                        color = TextPrimary,
                                    )
                                    Text(
                                        "$requests request${if (requests == 1) "" else "s"}",
                                        color = TextSecondary,
                                        fontSize = 12.sp,
                                    )
                                }
                                if (totalTokens > 0) {
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            formatTokens(totalTokens),
                                            fontWeight = FontWeight.SemiBold,
                                            color = TextPrimary,
                                        )
                                        Text("tokens", color = TextSecondary, fontSize = 12.sp)
                                    }
                                }
                            }

                            if (totalTokens > 0) {
                                Spacer(Modifier.height(10.dp))

                                // Token bar
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(6.dp),
                                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                                ) {
                                    val inputFraction = input.toFloat() / totalTokens
                                    val outputFraction = output.toFloat() / totalTokens
                                    Box(
                                        modifier = Modifier
                                            .weight(maxOf(0.01f, inputFraction))
                                            .fillMaxHeight()
                                            .clip(RoundedCornerShape(3.dp))
                                            .background(Accent.copy(alpha = 0.7f)),
                                    )
                                    Box(
                                        modifier = Modifier
                                            .weight(maxOf(0.01f, outputFraction))
                                            .fillMaxHeight()
                                            .clip(RoundedCornerShape(3.dp))
                                            .background(Accent),
                                    )
                                }

                                Spacer(Modifier.height(6.dp))

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Text(
                                        "${formatTokens(input)} in",
                                        color = TextSecondary,
                                        fontSize = 11.sp,
                                    )
                                    Text(
                                        "${formatTokens(output)} out",
                                        color = TextSecondary,
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RangePicker(selected: TimeRange, onSelect: (TimeRange) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(BgCard),
    ) {
        TimeRange.entries.forEach { range ->
            val isSelected = range == selected
            Surface(
                onClick = { onSelect(range) },
                modifier = Modifier.weight(1f),
                color = if (isSelected) Accent else BgCard,
                shape = RoundedCornerShape(10.dp),
            ) {
                Text(
                    range.label,
                    modifier = Modifier.padding(vertical = 8.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    color = if (isSelected) TextPrimary else TextSecondary,
                )
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                value,
                fontWeight = FontWeight.Bold,
                fontSize = 20.sp,
                color = TextPrimary,
            )
            Spacer(Modifier.height(4.dp))
            Text(label, color = TextSecondary, fontSize = 11.sp)
        }
    }
}

private fun formatTokens(n: Int): String = when {
    n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
    n >= 1_000 -> String.format("%.1fK", n / 1_000.0)
    else -> "$n"
}
