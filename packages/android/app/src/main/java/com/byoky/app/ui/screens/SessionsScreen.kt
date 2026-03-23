package com.byoky.app.ui.screens

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import android.text.format.DateUtils

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(wallet: WalletStore) {
    val sessions by wallet.sessions.collectAsState()

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
                item {
                    Text(
                        "${sessions.size} active session${if (sessions.size == 1) "" else "s"}",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
                items(sessions, key = { it.id }) { session ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = BgCard),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp),
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

                            IconButton(onClick = { wallet.revokeSession(session) }) {
                                Icon(
                                    Icons.Default.Close,
                                    "Revoke",
                                    tint = Danger,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
