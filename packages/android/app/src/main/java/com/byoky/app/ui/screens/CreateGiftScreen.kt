package com.byoky.app.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.*
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.launch

private data class TokenPreset(val label: String, val value: Int)
private data class ExpiryPreset(val label: String, val millis: Long)

private val tokenPresets = listOf(
    TokenPreset("10K", 10_000),
    TokenPreset("50K", 50_000),
    TokenPreset("100K", 100_000),
    TokenPreset("500K", 500_000),
    TokenPreset("1M", 1_000_000),
)

private val expiryPresets = listOf(
    ExpiryPreset("1 hour", 3_600_000L),
    ExpiryPreset("24 hours", 86_400_000L),
    ExpiryPreset("7 days", 604_800_000L),
    ExpiryPreset("30 days", 2_592_000_000L),
)

private const val RELAY_URL = "wss://relay.byoky.com"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateGiftScreen(wallet: WalletStore, onBack: () -> Unit) {
    val credentials by wallet.credentials.collectAsState()
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val context = LocalContext.current

    var selectedCredential by remember { mutableStateOf<Credential?>(null) }
    var selectedTokenPreset by remember { mutableIntStateOf(-1) }
    var customTokens by remember { mutableStateOf("") }
    var selectedExpiryIndex by remember { mutableIntStateOf(1) }
    var listPublicly by remember { mutableStateOf(false) }
    var gifterName by remember { mutableStateOf("") }
    var createdGift by remember { mutableStateOf<Gift?>(null) }
    var giftShortId by remember { mutableStateOf<String?>(null) }
    var dropdownExpanded by remember { mutableStateOf(false) }
    val coroutineScope = rememberCoroutineScope()

    // Keep the selection in sync with the credentials list: fall back to
    // the first credential whenever the current pick is nil or no longer
    // valid. Without this, the user lands on a blank dropdown and the
    // Create button is mysteriously disabled.
    LaunchedEffect(credentials) {
        if (credentials.isNotEmpty() && credentials.none { it.id == selectedCredential?.id }) {
            selectedCredential = credentials.first()
        }
    }

    // Keep the pool display name in sync with the credential label so the
    // pool card and redeem card show the same sender by default.
    LaunchedEffect(selectedCredential?.id) {
        selectedCredential?.label?.let { gifterName = it }
    }

    val tokenBudget = if (selectedTokenPreset >= 0) {
        tokenPresets[selectedTokenPreset].value
    } else {
        customTokens.toIntOrNull() ?: 0
    }

    val isValid = selectedCredential != null && tokenBudget > 0

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Create Gift") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = TextPrimary)
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
        Column(
            modifier = Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (credentials.isEmpty()) {
                NoCredentialsState(onBack)
            } else if (createdGift != null) {
                SuccessState(createdGift!!, giftShortId, context, onBack)
            } else {
                // Credential picker
                Text("Credential", color = TextSecondary, fontSize = 12.sp)
                ExposedDropdownMenuBox(
                    expanded = dropdownExpanded,
                    onExpandedChange = { dropdownExpanded = it },
                ) {
                    OutlinedTextField(
                        value = selectedCredential?.let {
                            val provider = Provider.find(it.providerId)
                            "${provider?.name ?: it.providerId} - ${it.label}"
                        } ?: "",
                        onValueChange = {},
                        readOnly = true,
                        placeholder = { Text("Select a credential") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Border,
                            focusedContainerColor = BgCard,
                            unfocusedContainerColor = BgCard,
                        ),
                        shape = RoundedCornerShape(12.dp),
                    )
                    ExposedDropdownMenu(
                        expanded = dropdownExpanded,
                        onDismissRequest = { dropdownExpanded = false },
                        containerColor = BgRaised,
                    ) {
                        credentials.forEach { credential ->
                            val provider = Provider.find(credential.providerId)
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(credential.label, color = TextPrimary)
                                        Text(
                                            provider?.name ?: credential.providerId,
                                            fontSize = 12.sp,
                                            color = TextSecondary,
                                        )
                                    }
                                },
                                onClick = {
                                    selectedCredential = credential
                                    dropdownExpanded = false
                                },
                            )
                        }
                    }
                }

                // Token budget
                Text("Token Budget", color = TextSecondary, fontSize = 12.sp)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    tokenPresets.forEachIndexed { index, preset ->
                        FilterChip(
                            selected = selectedTokenPreset == index,
                            onClick = {
                                selectedTokenPreset = index
                                customTokens = ""
                            },
                            label = { Text(preset.label, fontSize = 13.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AccentSoft,
                                selectedLabelColor = Accent,
                            ),
                        )
                    }
                }
                OutlinedTextField(
                    value = customTokens,
                    onValueChange = {
                        customTokens = it.filter { c -> c.isDigit() }
                        if (customTokens.isNotEmpty()) selectedTokenPreset = -1
                    },
                    placeholder = { Text("Custom amount") },
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

                // Expiry
                Text("Expiry", color = TextSecondary, fontSize = 12.sp)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    expiryPresets.forEachIndexed { index, preset ->
                        FilterChip(
                            selected = selectedExpiryIndex == index,
                            onClick = { selectedExpiryIndex = index },
                            label = { Text(preset.label, fontSize = 13.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AccentSoft,
                                selectedLabelColor = Accent,
                            ),
                        )
                    }
                }

                if (!cloudVaultEnabled) {
                    Spacer(Modifier.height(8.dp))
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
                                "Your device must stay online for the recipient to use this gift. Enable Cloud Sync in Settings for offline access.",
                                color = Warning,
                                fontSize = 13.sp,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(12.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("List on Token Pool", fontWeight = FontWeight.Medium)
                        Text(
                            "Make public at byoky.com/token-pool",
                            fontSize = 12.sp,
                            color = TextMuted,
                        )
                    }
                    Switch(checked = listPublicly, onCheckedChange = { listPublicly = it })
                }

                if (listPublicly) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = gifterName,
                        onValueChange = { gifterName = it },
                        label = { Text("Display name (optional)") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                    )
                }

                Spacer(Modifier.height(12.dp))

                Button(
                    onClick = {
                        val cred = selectedCredential ?: return@Button
                        val gift = wallet.createGift(
                            credentialId = cred.id,
                            providerId = cred.providerId,
                            label = cred.label,
                            maxTokens = tokenBudget,
                            expiresInMs = expiryPresets[selectedExpiryIndex].millis,
                            relayUrl = RELAY_URL,
                            listPublicly = listPublicly,
                            gifterName = if (listPublicly) gifterName.ifBlank { null } else null,
                        )
                        createdGift = gift
                        giftShortId = null
                        if (gift != null) {
                            val (encoded, _) = createGiftLink(gift)
                            coroutineScope.launch {
                                // Silent fallback to the long URL if the vault is unreachable
                                // or the user isn't signed into cloud sync.
                                val allocated = wallet.createGiftShortLink(encoded, gift.expiresAt)
                                giftShortId = allocated
                                if (allocated != null) {
                                    wallet.setGiftShortId(gift.id, allocated)
                                }
                            }
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
                    Text("Create Gift", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun NoCredentialsState(onBack: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(32.dp))

        Icon(
            Icons.Default.VpnKeyOff,
            contentDescription = null,
            tint = TextMuted,
            modifier = Modifier.size(48.dp),
        )

        Text(
            "No Credentials",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )

        Text(
            "Add a credential first before you can gift tokens. Open the Wallet tab and tap the + button to add one.",
            color = TextSecondary,
            fontSize = 14.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )

        Button(
            onClick = onBack,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Accent),
        ) {
            Text("Go back", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun SuccessState(gift: Gift, shortId: String?, context: Context, onBack: () -> Unit) {
    val (encoded, _) = createGiftLink(gift)
    // Prefer the short URL once allocated; fall back to the long URL while
    // the vault POST is in flight or if it failed.
    val url = shortId?.let { giftShortLinkToUrl(it) } ?: giftLinkToUrl(encoded)
    val provider = Provider.find(gift.providerId)

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(16.dp))

        Icon(
            Icons.Default.CheckCircle,
            contentDescription = null,
            tint = Success,
            modifier = Modifier.size(48.dp),
        )

        Text(
            "Gift Created!",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )

        Card(
            colors = CardDefaults.cardColors(containerColor = BgCard),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                DetailRow("Provider", provider?.name ?: gift.providerId)
                DetailRow("Budget", formatTokens(gift.maxTokens) + " tokens")
                DetailRow("Expires", formatExpiryFromNow(gift.expiresAt))
            }
        }

        OutlinedTextField(
            value = url,
            onValueChange = {},
            readOnly = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Border,
                unfocusedBorderColor = Border,
                focusedContainerColor = BgCard,
                unfocusedContainerColor = BgCard,
            ),
            shape = RoundedCornerShape(12.dp),
            maxLines = 3,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Gift Link", url))
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Accent),
            ) {
                Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Copy")
            }
            Button(
                onClick = {
                    val shareText = "I'm sharing ${formatTokens(gift.maxTokens)} tokens of ${provider?.name ?: gift.providerId} via Byoky! $url"
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, shareText)
                    }
                    context.startActivity(Intent.createChooser(intent, "Share Gift"))
                },
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Icon(Icons.Default.Share, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Share")
            }
        }

        TextButton(onClick = onBack) {
            Text("Done", color = TextSecondary)
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = TextSecondary, fontSize = 13.sp)
        Text(value, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

private fun formatExpiryFromNow(expiresAt: Long): String {
    val remaining = expiresAt - System.currentTimeMillis()
    if (remaining <= 0) return "Expired"
    val hours = remaining / 3_600_000
    val days = hours / 24
    return when {
        days > 0 -> "in ${days} day${if (days == 1L) "" else "s"}"
        hours > 0 -> "in ${hours} hour${if (hours == 1L) "" else "s"}"
        else -> "in ${remaining / 60_000} min"
    }
}
