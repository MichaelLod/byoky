package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.Provider
import com.byoky.app.data.Session
import com.byoky.app.data.TokenAllowance
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import android.text.format.DateUtils

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(wallet: WalletStore) {
    val sessions by wallet.sessions.collectAsState()
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val allowances by wallet.tokenAllowances.collectAsState()
    val requestLogs by wallet.requestLogs.collectAsState()
    var editingSession by remember { mutableStateOf<Session?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Sessions") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        if (sessions.isEmpty()) {
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Icon(
                    Icons.Default.Link,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(48.dp),
                )
                Spacer(Modifier.height(16.dp))
                Text("No Active Sessions", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Spacer(Modifier.height(8.dp))
                Text(
                    "When you approve a website to use your API keys, its session will appear here. You can revoke access at any time.",
                    color = TextSecondary,
                    textAlign = TextAlign.Center,
                    fontSize = 14.sp,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (!cloudVaultEnabled) {
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Warning.copy(alpha = 0.1f)),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(Icons.Default.Wifi, null, tint = Warning, modifier = Modifier.size(16.dp))
                                Text(
                                    "Your device must stay online for connected apps to work. Enable Cloud Vault in Settings for offline access.",
                                    color = Warning,
                                    fontSize = 13.sp,
                                )
                            }
                        }
                    }
                }
                item {
                    Text(
                        "${sessions.size} active session${if (sessions.size == 1) "" else "s"}",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
                items(sessions, key = { it.id }) { session ->
                    val allowance = allowances.firstOrNull { it.origin == session.appOrigin }
                    val tokensUsed = wallet.tokenUsage(session.appOrigin)

                    Card(
                        colors = CardDefaults.cardColors(containerColor = BgCard),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        session.appOrigin,
                                        fontWeight = FontWeight.Medium,
                                        color = TextPrimary,
                                    )
                                    Spacer(Modifier.height(4.dp))
                                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text(
                                            "${session.providers.size} provider${if (session.providers.size == 1) "" else "s"}",
                                            fontSize = 12.sp,
                                            color = TextSecondary,
                                        )
                                        Text(
                                            DateUtils.getRelativeTimeSpanString(
                                                session.expiresAt,
                                                System.currentTimeMillis(),
                                                DateUtils.MINUTE_IN_MILLIS,
                                            ).toString(),
                                            fontSize = 12.sp,
                                            color = TextMuted,
                                        )
                                    }
                                }

                                IconButton(onClick = { editingSession = session }) {
                                    Icon(
                                        Icons.Default.Speed,
                                        "Set limit",
                                        tint = Accent,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }

                                IconButton(onClick = { wallet.revokeSession(session) }) {
                                    Icon(
                                        Icons.Default.Close,
                                        "Revoke",
                                        tint = Danger,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                            }

                            Spacer(Modifier.height(8.dp))

                            if (allowance?.totalLimit != null) {
                                val limit = allowance.totalLimit!!
                                val progress = (tokensUsed.toFloat() / limit).coerceIn(0f, 1f)
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    LinearProgressIndicator(
                                        progress = { progress },
                                        modifier = Modifier.weight(1f).height(6.dp),
                                        color = if (progress >= 0.8f) Warning else Accent,
                                        trackColor = TextMuted.copy(alpha = 0.2f),
                                    )
                                    Text(
                                        "${formatTokens(tokensUsed)} / ${formatTokens(limit)}",
                                        fontSize = 11.sp,
                                        color = TextMuted,
                                    )
                                }
                            } else {
                                Text(
                                    "${formatTokens(tokensUsed)} tokens used",
                                    fontSize = 11.sp,
                                    color = TextMuted,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    editingSession?.let { session ->
        val allowance = allowances.firstOrNull { it.origin == session.appOrigin }
        AllowanceDialog(
            origin = session.appOrigin,
            providers = session.providers,
            allowance = allowance,
            onSave = { wallet.setAllowance(it); editingSession = null },
            onRemove = { wallet.removeAllowance(session.appOrigin); editingSession = null },
            onDismiss = { editingSession = null },
        )
    }
}

@Composable
private fun AllowanceDialog(
    origin: String,
    providers: List<String>,
    allowance: TokenAllowance?,
    onSave: (TokenAllowance) -> Unit,
    onRemove: () -> Unit,
    onDismiss: () -> Unit,
) {
    var totalLimit by remember { mutableStateOf(allowance?.totalLimit?.toString() ?: "") }
    var providerLimits by remember {
        mutableStateOf(
            providers.associateWith { id ->
                allowance?.providerLimits?.get(id)?.toString() ?: ""
            }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Token Limit", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(origin, color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.Medium)

                OutlinedTextField(
                    value = totalLimit,
                    onValueChange = { totalLimit = it },
                    label = { Text("Total token limit") },
                    placeholder = { Text("Unlimited") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )

                if (providers.isNotEmpty()) {
                    Text("Per provider", color = TextSecondary, fontSize = 12.sp)
                    providers.forEach { id ->
                        OutlinedTextField(
                            value = providerLimits[id] ?: "",
                            onValueChange = { providerLimits = providerLimits + (id to it) },
                            label = { Text(Provider.find(id)?.name ?: id) },
                            placeholder = { Text("Unlimited") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val total = totalLimit.toIntOrNull()?.takeIf { it > 0 }
                val pLimits = providerLimits
                    .mapValues { (_, v) -> v.toIntOrNull() ?: 0 }
                    .filterValues { it > 0 }
                    .takeIf { it.isNotEmpty() }
                onSave(TokenAllowance(origin = origin, totalLimit = total, providerLimits = pLimits))
            }) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (allowance != null) {
                    TextButton(onClick = onRemove) {
                        Text("Remove", color = Danger)
                    }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

private fun formatTokens(count: Int): String {
    return when {
        count >= 1_000_000 -> String.format("%.1fM", count / 1_000_000.0)
        count >= 1_000 -> String.format("%.0fK", count / 1_000.0)
        else -> count.toString()
    }
}
