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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.launch

private const val DISMISS_COOLDOWN_MS = 7L * 24 * 60 * 60 * 1000

@Composable
fun OfflineUpgradeBanner(wallet: WalletStore) {
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val dismissedAt by wallet.vaultBannerDismissedAt.collectAsState()
    val scope = rememberCoroutineScope()

    val shouldShow = !cloudVaultEnabled && (dismissedAt == 0L || System.currentTimeMillis() - dismissedAt > DISMISS_COOLDOWN_MS)
    if (!shouldShow) return

    var expanded by remember { mutableStateOf(false) }
    var username by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }

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

        if (!expanded) {
            Button(
                onClick = { expanded = true },
                shape = RoundedCornerShape(6.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text("Activate Cloud Sync", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        } else {
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("Username") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Accent,
                    unfocusedBorderColor = Border,
                    focusedContainerColor = BgRaised,
                    unfocusedContainerColor = BgRaised,
                ),
                shape = RoundedCornerShape(8.dp),
            )

            error?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, color = Danger, fontSize = 11.sp)
            }

            Spacer(Modifier.height(8.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        val trimmed = username.lowercase().trim()
                        if (trimmed.isEmpty()) return@Button
                        loading = true
                        error = null
                        scope.launch {
                            try {
                                wallet.vaultActivate(trimmed)
                                expanded = false
                                username = ""
                            } catch (e: Exception) {
                                error = e.message ?: "Failed to activate Cloud Sync"
                            } finally {
                                loading = false
                            }
                        }
                    },
                    enabled = username.isNotBlank() && !loading,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(6.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Accent,
                        disabledContainerColor = Accent.copy(alpha = 0.3f),
                    ),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    Text(if (loading) "Activating..." else "Activate", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }

                TextButton(
                    onClick = {
                        expanded = false
                        username = ""
                        error = null
                    },
                ) {
                    Text("Cancel", color = TextSecondary, fontSize = 12.sp)
                }
            }
        }
    }
}
