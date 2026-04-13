package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.GiftedCredential
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.data.formatTokens
import com.byoky.app.data.giftBudgetPercent
import com.byoky.app.data.giftBudgetRemaining
import com.byoky.app.data.isGiftExpired
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    wallet: WalletStore,
    onNavigateToSettings: () -> Unit = {},
    onNavigateToRedeemGift: () -> Unit = {},
) {
    val credentials by wallet.credentials.collectAsState()
    val giftedCredentials by wallet.giftedCredentials.collectAsState()
    val giftPeerOnline by wallet.giftPeerOnline.collectAsState()
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    var showAddSheet by remember { mutableStateOf(false) }
    var showCloudVaultSetup by remember { mutableStateOf(false) }
    var addMenuOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val activeGifts = remember(giftedCredentials) {
        giftedCredentials.filter { !isGiftExpired(it.expiresAt) }
    }

    // Probe gift relays each time the Wallet tab becomes active so the
    // online dot reflects the latest sender status.
    LaunchedEffect(activeGifts.map { it.giftId }) {
        if (activeGifts.isNotEmpty()) wallet.probeGiftPeers()
    }

    val hasAny = credentials.isNotEmpty() || activeGifts.isNotEmpty()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wallet") },
                actions = {
                    TextButton(onClick = {
                        if (cloudVaultEnabled) {
                            scope.launch { wallet.disableCloudVault() }
                        } else {
                            showCloudVaultSetup = true
                        }
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Vault", fontSize = 14.sp, color = if (cloudVaultEnabled) Accent else TextMuted)
                            Icon(
                                if (cloudVaultEnabled) Icons.Default.Cloud else Icons.Default.CloudOff,
                                "Cloud Vault",
                                tint = if (cloudVaultEnabled) Accent else TextMuted,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                    Box {
                        IconButton(onClick = { addMenuOpen = true }) {
                            Icon(Icons.Default.AddCircle, "Add", tint = Accent)
                        }
                        DropdownMenu(
                            expanded = addMenuOpen,
                            onDismissRequest = { addMenuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("Add API Key") },
                                leadingIcon = { Icon(Icons.Default.Key, null, tint = Accent) },
                                onClick = {
                                    addMenuOpen = false
                                    showAddSheet = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Redeem gift") },
                                leadingIcon = { Icon(Icons.Default.Redeem, null, tint = Accent) },
                                onClick = {
                                    addMenuOpen = false
                                    onNavigateToRedeemGift()
                                },
                            )
                        }
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, "Settings", tint = TextSecondary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = BgMain,
                    titleContentColor = TextPrimary,
                ),
            )
        },
        containerColor = BgMain,
    ) { padding ->
        if (!hasAny) {
            Column(modifier = Modifier.padding(padding)) {
                EmptyWallet(
                    modifier = Modifier,
                    onAdd = { showAddSheet = true },
                    onRedeemGift = onNavigateToRedeemGift,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (credentials.isNotEmpty()) {
                    item {
                        Text(
                            "${credentials.size} credential${if (credentials.size == 1) "" else "s"}",
                            color = TextSecondary,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                    items(credentials, key = { it.id }) { credential ->
                        CredentialCard(credential) {
                            wallet.removeCredential(credential)
                        }
                    }
                }
                if (activeGifts.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "${activeGifts.size} gift${if (activeGifts.size == 1) "" else "s"}",
                            color = TextSecondary,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                    items(activeGifts, key = { it.id }) { gc ->
                        GiftCredentialCard(
                            gc = gc,
                            online = giftPeerOnline[gc.giftId],
                            hasOwnKey = credentials.any { it.providerId == gc.providerId },
                            isPreferred = wallet.giftPreferences.collectAsState().value[gc.providerId] == gc.giftId,
                            onPreferredChange = { preferred ->
                                wallet.setGiftPreference(gc.providerId, if (preferred) gc.giftId else null)
                            },
                            onRemove = { wallet.removeGiftedCredential(gc.id) },
                        )
                    }
                }
            }
        }

        if (showAddSheet) {
            AddCredentialSheet(wallet) { showAddSheet = false }
        }

        if (showCloudVaultSetup) {
            CloudVaultSetupDialog(
                wallet = wallet,
                onDismiss = { showCloudVaultSetup = false },
            )
        }
    }
}

@Composable
private fun EmptyWallet(modifier: Modifier, onAdd: () -> Unit, onRedeemGift: () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Default.Key,
            contentDescription = null,
            tint = TextMuted,
            modifier = Modifier.size(48.dp),
        )
        Spacer(Modifier.height(16.dp))
        Text("No credentials or gifts", fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Spacer(Modifier.height(8.dp))
        Text(
            "Add your first API key or redeem a gift to get started. Keys are encrypted with your master password and stored securely.",
            color = TextSecondary,
            textAlign = TextAlign.Center,
            fontSize = 14.sp,
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onAdd,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Add API Key")
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = onRedeemGift,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
        ) {
            Icon(Icons.Default.Redeem, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Redeem Gift")
        }
    }
}

/**
 * Renders a received gift as a wallet credential. Mirrors [CredentialCard]'s
 * shape but shows a peer online dot, tokens-remaining bar, and sender label.
 * The green/red dot reflects [online] (null = still probing, yellow).
 */
@Composable
private fun GiftCredentialCard(
    gc: GiftedCredential,
    online: Boolean?,
    hasOwnKey: Boolean,
    isPreferred: Boolean,
    onPreferredChange: (Boolean) -> Unit,
    onRemove: () -> Unit,
) {
    val provider = Provider.find(gc.providerId)
    val remaining = giftBudgetRemaining(gc.usedTokens, gc.maxTokens)
    val percent = giftBudgetPercent(gc.usedTokens, gc.maxTokens)
    val dotColor = when (online) {
        true -> Color(0xFF34D399)   // green — sender online
        false -> Color(0xFFF43F5E)  // red — sender offline
        null -> Color(0xFFF59E0B)   // amber — still probing
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(AccentSoft),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.CardGiftcard,
                        contentDescription = null,
                        tint = Accent,
                        modifier = Modifier.size(20.dp),
                    )
                }

                Spacer(Modifier.width(14.dp))

                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(dotColor),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            provider?.name ?: gc.providerId,
                            fontWeight = FontWeight.Medium,
                            color = TextPrimary,
                        )
                    }
                    Text(
                        "Gift from ${gc.senderLabel}",
                        fontSize = 12.sp,
                        color = TextSecondary,
                    )
                }

                Text(
                    "Gift",
                    fontSize = 11.sp,
                    color = Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(AccentSoft)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )

                IconButton(onClick = onRemove) {
                    Icon(Icons.Default.Delete, "Remove", tint = TextMuted, modifier = Modifier.size(18.dp))
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

            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "${formatTokens(remaining)} / ${formatTokens(gc.maxTokens)} left",
                    fontSize = 11.sp,
                    color = TextSecondary,
                )
                Text(
                    formatGiftExpiry(gc.expiresAt),
                    fontSize = 11.sp,
                    color = TextMuted,
                )
            }

            if (hasOwnKey) {
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Use instead of own key",
                        fontSize = 12.sp,
                        color = TextSecondary,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(
                        checked = isPreferred,
                        onCheckedChange = onPreferredChange,
                        colors = SwitchDefaults.colors(checkedTrackColor = Accent),
                    )
                }
            }
        }
    }
}

private fun formatGiftExpiry(expiresAt: Long): String {
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

@Composable
private fun CredentialCard(credential: Credential, onDelete: () -> Unit) {
    val provider = Provider.find(credential.providerId)

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
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(AccentSoft),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.Key,
                    contentDescription = null,
                    tint = Accent,
                    modifier = Modifier.size(20.dp),
                )
            }

            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    credential.label,
                    fontWeight = FontWeight.Medium,
                    color = TextPrimary,
                )
                Text(
                    provider?.name ?: credential.providerId,
                    fontSize = 12.sp,
                    color = TextSecondary,
                )
            }

            Text(
                if (credential.authMethod == AuthMethod.API_KEY) "API Key" else "OAuth",
                fontSize = 11.sp,
                color = TextSecondary,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(BgHover)
                    .padding(horizontal = 8.dp, vertical = 4.dp),
            )

            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Remove", tint = TextMuted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddCredentialSheet(wallet: WalletStore, onDismiss: () -> Unit) {
    var selectedProvider by remember { mutableStateOf<Provider?>(null) }
    var label by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var authMethod by remember { mutableStateOf(AuthMethod.API_KEY) }
    var error by remember { mutableStateOf<String?>(null) }

    val supportsSetupToken = selectedProvider?.id == "anthropic"

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = BgRaised,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            Text(
                "Add API Key",
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )

            Spacer(Modifier.height(20.dp))

            Text("Provider", color = TextSecondary, fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))

            LazyColumn(
                modifier = Modifier.heightIn(max = 200.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(Provider.all) { provider ->
                    Surface(
                        onClick = {
                            selectedProvider = provider
                            if (label.isEmpty()) label = provider.name
                            if (provider.id != "anthropic") authMethod = AuthMethod.API_KEY
                        },
                        color = if (selectedProvider?.id == provider.id) AccentSoft else BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(provider.name, color = TextPrimary, modifier = Modifier.weight(1f))
                            if (selectedProvider?.id == provider.id) {
                                Icon(Icons.Default.Check, null, tint = Accent, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }

            if (selectedProvider != null) {
                if (supportsSetupToken) {
                    Spacer(Modifier.height(16.dp))
                    Text("Credential Type", color = TextSecondary, fontSize = 12.sp)
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilterChip(
                            selected = authMethod == AuthMethod.API_KEY,
                            onClick = { authMethod = AuthMethod.API_KEY },
                            label = { Text("API Key") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AccentSoft,
                                selectedLabelColor = Accent,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                        FilterChip(
                            selected = authMethod == AuthMethod.OAUTH,
                            onClick = { authMethod = AuthMethod.OAUTH },
                            label = { Text("Setup Token") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AccentSoft,
                                selectedLabelColor = Accent,
                            ),
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text("Label") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Border,
                        focusedContainerColor = BgCard,
                        unfocusedContainerColor = BgCard,
                    ),
                    shape = RoundedCornerShape(12.dp),
                )

                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it },
                    label = { Text(if (authMethod == AuthMethod.OAUTH) "Setup Token" else "API Key") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = Border,
                        focusedContainerColor = BgCard,
                        unfocusedContainerColor = BgCard,
                    ),
                    shape = RoundedCornerShape(12.dp),
                )

                if (authMethod == AuthMethod.OAUTH) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Run `claude setup-token` in your terminal to get a token. Setup tokens use your Claude Pro/Max subscription.",
                        color = TextSecondary,
                        fontSize = 12.sp,
                    )
                } else {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Your key will be encrypted with AES-256-GCM and stored securely. It never leaves this device.",
                        color = TextSecondary,
                        fontSize = 12.sp,
                    )
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Danger, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            val isValid = selectedProvider != null && label.isNotBlank() && apiKey.isNotBlank()

            Button(
                onClick = {
                    try {
                        wallet.addCredential(selectedProvider!!.id, label, apiKey, authMethod)
                        onDismiss()
                    } catch (e: Exception) {
                        error = e.message
                    }
                },
                enabled = isValid,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text("Save", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
