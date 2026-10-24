package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
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
import com.byoky.app.data.CredentialBaseUrl
import com.byoky.app.data.CredentialUsageStats
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.ProviderIcon
import com.byoky.app.ui.components.RetiredFeaturesNotice
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    wallet: WalletStore,
    onNavigateToSettings: () -> Unit = {},
) {
    val credentials by wallet.credentials.collectAsState()
    val requestLogs by wallet.requestLogs.collectAsState()
    val showRetiredNotice by wallet.retiredFeaturesNotice.collectAsState()
    var showAddSheet by remember { mutableStateOf(false) }
    var statsCredentialId by remember { mutableStateOf<String?>(null) }
    var renameTarget by remember { mutableStateOf<Credential?>(null) }
    var removeTarget by remember { mutableStateOf<Credential?>(null) }

    // Aggregate the last 7 days of successful requests per provider. Per-credential
    // granularity isn't possible (request log only carries providerId, not a
    // credentialId), so multiple credentials of the same provider share these
    // numbers — acceptable for an at-a-glance card.
    val usageByProvider = remember(requestLogs) {
        val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
        val acc = mutableMapOf<String, IntArray>()  // [requests, input, output]
        for (log in requestLogs) {
            if (log.timestamp < cutoff || log.statusCode >= 400) continue
            val arr = acc.getOrPut(log.providerId) { IntArray(3) }
            arr[0] += 1
            arr[1] += log.inputTokens ?: 0
            arr[2] += log.outputTokens ?: 0
        }
        acc.mapValues { CredentialUsageStats(it.value[0], it.value[1], it.value[2]) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wallet") },
                actions = {
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
        if (credentials.isEmpty()) {
            Column(modifier = Modifier.padding(padding)) {
                RetiredFeaturesNotice(
                    wallet,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    onOpenSettings = onNavigateToSettings,
                )
                EmptyWallet(
                    modifier = Modifier,
                    onAdd = { showAddSheet = true },
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (showRetiredNotice) {
                    item { RetiredFeaturesNotice(wallet, onOpenSettings = onNavigateToSettings) }
                }
                item {
                    Text(
                        "${credentials.size} credential${if (credentials.size == 1) "" else "s"}",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }
                items(credentials, key = { it.id }) { credential ->
                    CredentialCard(
                        credential = credential,
                        usage = usageByProvider[credential.providerId],
                        onOpenStats = { statsCredentialId = credential.id },
                        onRename = { renameTarget = credential },
                        onDelete = { removeTarget = credential },
                    )
                }
            }
        }

        if (showAddSheet) {
            AddCredentialSheet(wallet) { showAddSheet = false }
        }

        renameTarget?.let { target ->
            RenameCredentialDialog(
                initialLabel = target.label,
                onDismiss = { renameTarget = null },
                onConfirm = { newLabel ->
                    wallet.updateCredentialLabel(target.id, newLabel)
                    renameTarget = null
                },
            )
        }

        removeTarget?.let { target ->
            RemoveCredentialDialog(
                label = target.label,
                onDismiss = { removeTarget = null },
                onConfirm = {
                    wallet.removeCredential(target)
                    removeTarget = null
                },
            )
        }

        statsCredentialId?.let { id ->
            WalletStatsSheet(
                credentialId = id,
                credentials = credentials,
                requestLogs = requestLogs,
                onDismiss = { statsCredentialId = null },
            )
        }
    }
}

/** Asked before a key is deleted from the wallet. */
@Composable
private fun RemoveCredentialDialog(
    label: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Remove $label?", color = TextPrimary) },
        text = {
            Text(
                "Apps using this key lose access to it. This can't be undone unless you have a backup that includes it.",
                color = TextSecondary,
                fontSize = 13.sp,
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Remove", color = Danger) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
        containerColor = BgCard,
    )
}

@Composable
private fun RenameCredentialDialog(
    initialLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var draft by remember { mutableStateOf(initialLabel) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Rename credential") },
        text = {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onConfirm(draft) },
                enabled = draft.trim().isNotEmpty() && draft.trim() != initialLabel,
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
        containerColor = BgCard,
    )
}

@Composable
private fun EmptyWallet(modifier: Modifier, onAdd: () -> Unit) {
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
        Text("No credentials yet", fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Spacer(Modifier.height(8.dp))
        Text(
            "Add your first API key to get started. Keys are encrypted with your master password and never leave this device.",
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
    }
}

@Composable
private fun CredentialCard(
    credential: Credential,
    usage: CredentialUsageStats?,
    onOpenStats: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val provider = Provider.find(credential.providerId)
    val hasUsage = usage != null && usage.requests > 0

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.clickable { onOpenStats() },
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.Black),
                    contentAlignment = Alignment.Center,
                ) {
                    ProviderIcon(
                        providerId = credential.providerId,
                        tint = Color.White,
                        size = 20.dp,
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

                IconButton(onClick = onRename, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Edit, "Rename", tint = TextMuted, modifier = Modifier.size(18.dp))
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

                IconButton(onClick = onDelete, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Delete, "Remove", tint = TextMuted, modifier = Modifier.size(18.dp))
                }
            }

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = BgHover)
            Spacer(Modifier.height(10.dp))

            Text(
                "LAST 7 DAYS",
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = TextMuted,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                UsageStat(
                    value = if (hasUsage) usage!!.requests.toString() else "0",
                    label = "requests",
                )
                UsageStat(
                    value = formatUsageTokens(if (hasUsage) usage!!.inputTokens else 0),
                    label = "input",
                )
                UsageStat(
                    value = formatUsageTokens(if (hasUsage) usage!!.outputTokens else 0),
                    label = "output",
                )
            }
        }
    }
}

@Composable
private fun UsageStat(value: String, label: String) {
    Column {
        Text(value, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Text(label, fontSize = 11.sp, color = TextMuted)
    }
}

private fun formatUsageTokens(n: Int): String = when {
    n >= 1_000_000 -> "%.1fM".format(n / 1_000_000.0)
    n >= 1_000 -> "%dK".format(n / 1_000)
    else -> n.toString()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AddCredentialSheet(wallet: WalletStore, onDismiss: () -> Unit) {
    var selectedProvider by remember { mutableStateOf<Provider?>(null) }
    var label by remember { mutableStateOf("") }
    var apiKey by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var authMethod by remember { mutableStateOf(AuthMethod.API_KEY) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val supportsSetupToken = selectedProvider?.id == "anthropic"
    val isLocalProvider = selectedProvider?.id == "ollama" || selectedProvider?.id == "lm_studio"
    // Azure OpenAI and local servers have no fixed host: the key may only
    // ever be sent to the URL stored with it, so one is required.
    val needsBaseUrl = selectedProvider?.requiresCustomBaseUrl == true
    val normalizedBaseUrl = selectedProvider?.let { CredentialBaseUrl.normalize(it.id, baseUrl) }
    val defaultBaseUrlForProvider: String = when (selectedProvider?.id) {
        "ollama" -> "http://localhost:11434"
        "lm_studio" -> "http://localhost:1234"
        "azure_openai" -> "https://my-resource.openai.azure.com"
        else -> ""
    }

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
                            // A server URL belongs to one provider; never carry it over.
                            baseUrl = when (provider.id) {
                                "ollama" -> "http://localhost:11434"
                                "lm_studio" -> "http://localhost:1234"
                                else -> ""
                            }
                        },
                        color = if (selectedProvider?.id == provider.id) AccentSoft else BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Color.Black),
                                contentAlignment = Alignment.Center,
                            ) {
                                ProviderIcon(
                                    providerId = provider.id,
                                    tint = Color.White,
                                    size = 18.dp,
                                )
                            }
                            Spacer(Modifier.width(12.dp))
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

                if (needsBaseUrl) {
                    OutlinedTextField(
                        value = baseUrl,
                        onValueChange = { baseUrl = it },
                        label = { Text(if (isLocalProvider) "Server URL" else "Endpoint URL") },
                        placeholder = { Text(defaultBaseUrlForProvider) },
                        singleLine = true,
                        isError = baseUrl.isNotBlank() && normalizedBaseUrl == null,
                        supportingText = { Text(CredentialBaseUrl.requirementText(selectedProvider!!.id), fontSize = 11.sp) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Accent,
                            unfocusedBorderColor = Border,
                            focusedContainerColor = BgCard,
                            unfocusedContainerColor = BgCard,
                        ),
                        shape = RoundedCornerShape(12.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when (selectedProvider?.id) {
                            "ollama" -> "Where your Ollama server is running. Make sure `ollama serve` is active."
                            "lm_studio" -> "Where your LM Studio server is running. Start the \"Local Server\" in LM Studio."
                            else -> "Your key is only ever sent to this endpoint."
                        },
                        color = TextSecondary,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    if (isLocalProvider) Row(verticalAlignment = Alignment.Top) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = Color(0xFFFF8A00),
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "Plain http:// only works for a server on this phone (localhost or 127.0.0.1). A server elsewhere on your network needs https://. Requests fail while the server is offline or asleep.",
                            color = Color(0xFFFF8A00),
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }

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
                    label = {
                        Text(
                            when {
                                authMethod == AuthMethod.OAUTH -> "Setup Token"
                                isLocalProvider -> "API Key (optional)"
                                else -> "API Key"
                            }
                        )
                    },
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
                } else if (isLocalProvider) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Leave blank if your local server has no auth. Any key you enter is stored encrypted on-device and forwarded as a Bearer token.",
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

            val isValid = selectedProvider != null && label.isNotBlank() &&
                (!needsBaseUrl || normalizedBaseUrl != null) &&
                (isLocalProvider || apiKey.isNotBlank())

            Button(
                onClick = {
                    if (saving) return@Button
                    saving = true
                    error = null
                    val providerId = selectedProvider!!.id
                    val cleanKey = apiKey.filter { !it.isWhitespace() }
                    val base = if (needsBaseUrl) normalizedBaseUrl else null
                    scope.launch {
                        // Encryption (PBKDF2) runs on Dispatchers.Default inside addCredential().
                        try {
                            wallet.addCredential(providerId, label, cleanKey, authMethod, base)
                            onDismiss()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            error = e.message
                        } finally {
                            saving = false
                        }
                    }
                },
                enabled = isValid && !saving,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                if (saving) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Encrypting…", fontWeight = FontWeight.SemiBold)
                } else {
                    Text("Save", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
