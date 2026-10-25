package com.byoky.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.byoky.app.data.ApiKeyFormat
import com.byoky.app.data.AuthMethod
import com.byoky.app.data.Credential
import com.byoky.app.data.CredentialBaseUrl
import com.byoky.app.data.CredentialUsageStats
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.ProviderTile
import com.byoky.app.ui.components.RavenFrame
import com.byoky.app.ui.components.RavenGaze
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetiredFeaturesNotice
import com.byoky.app.ui.components.RetroBottomSheet
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.SectionLabel
import com.byoky.app.ui.components.StatusPill
import com.byoky.app.ui.components.bottomSeam
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.panel
import com.byoky.app.ui.components.rememberRavenGaze
import com.byoky.app.ui.components.scanlines
import com.byoky.app.ui.components.watchedBy
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    wallet: WalletStore,
    onNavigateToSettings: () -> Unit = {},
    nodOnAppear: Boolean = false,
    onNodShown: () -> Unit = {},
) {
    val credentials by wallet.credentials.collectAsState()
    val requestLogs by wallet.requestLogs.collectAsState()
    val showRetiredNotice by wallet.retiredFeaturesNotice.collectAsState()
    var showAddSheet by remember { mutableStateOf(false) }
    var statsCredentialId by remember { mutableStateOf<String?>(null) }
    var renameTarget by remember { mutableStateOf<Credential?>(null) }
    var removeTarget by remember { mutableStateOf<Credential?>(null) }
    val gaze = rememberRavenGaze()
    // Fixed for this visit to the tab, so the nod plays once and isn't cut short.
    val nodKey = remember { if (nodOnAppear) Any() else null }
    LaunchedEffect(Unit) {
        if (nodOnAppear) onNodShown()
    }

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
        modifier = Modifier
            .background(Void)
            .dotGrid()
            .watchedBy(gaze),
        topBar = {
            WalletHeader(
                keyCount = credentials.size,
                gaze = gaze,
                nodKey = nodKey,
                onOpenSettings = onNavigateToSettings,
            )
        },
        containerColor = Color.Transparent,
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
                contentPadding = PaddingValues(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (showRetiredNotice) {
                    item { RetiredFeaturesNotice(wallet, onOpenSettings = onNavigateToSettings) }
                }
                item {
                    SectionLabel(
                        "${credentials.size} credential${if (credentials.size == 1) "" else "s"}",
                        modifier = Modifier.padding(bottom = 2.dp),
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

/**
 * Wallet header: the Byoky lockup and Settings, then the status line and the
 * screen title, with Muninn perched on the right watching the finger.
 */
@Composable
private fun WalletHeader(
    keyCount: Int,
    gaze: RavenGaze,
    nodKey: Any?,
    onOpenSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .scanlines()
            .bottomSeam()
            .statusBarsPadding()
            .padding(start = 20.dp, end = 8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onOpenSettings) {
                Icon(Icons.Default.Settings, "Settings", tint = Fog)
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(bottom = 16.dp),
            ) {
                StatusPill("Unlocked · $keyCount key${if (keyCount == 1) "" else "s"}", color = Signal)
                Spacer(Modifier.height(6.dp))
                CapsText(
                    "Wallet",
                    style = DisplayStyle.copy(fontSize = 34.sp, lineHeight = 38.sp, letterSpacing = 0.04.em),
                    color = Bone,
                )
            }
            Muninn(
                RavenMood.WATCHING,
                modifier = Modifier
                    .padding(end = 8.dp)
                    .size(96.dp),
                frame = RavenFrame.BUST,
                gaze = gaze,
                nodKey = nodKey,
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
    RetroDialog(
        onDismissRequest = onDismiss,
        title = "Remove $label?",
        text = {
            Text(
                "Apps using this key lose access to it. This can't be undone unless you have a backup that includes it.",
                fontSize = 13.sp,
            )
        },
        confirmButton = {
            DialogButton("Remove", onClick = onConfirm, color = Alarm)
        },
        dismissButton = {
            DialogButton("Cancel", onClick = onDismiss, color = Fog)
        },
    )
}

@Composable
private fun RenameCredentialDialog(
    initialLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var draft by remember { mutableStateOf(initialLabel) }

    RetroDialog(
        onDismissRequest = onDismiss,
        title = "Rename credential",
        text = {
            RetroTextField(
                value = draft,
                onValueChange = { draft = it },
                label = null,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            DialogButton(
                "Save",
                onClick = { onConfirm(draft) },
                enabled = draft.trim().isNotEmpty() && draft.trim() != initialLabel,
            )
        },
        dismissButton = {
            DialogButton("Cancel", onClick = onDismiss, color = Fog)
        },
    )
}

@Composable
private fun EmptyWallet(modifier: Modifier, onAdd: () -> Unit) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(64.dp)
                .border(1.dp, SeamStrong),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Key, contentDescription = null, tint = Phosphor, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(18.dp))
        CapsText("No credentials yet", style = HeadingStyle, color = Bone)
        Spacer(Modifier.height(8.dp))
        Text(
            "Add your first API key to get started. Keys are encrypted with your master password and never leave this device.",
            color = Fog,
            textAlign = TextAlign.Center,
            fontSize = 14.sp,
            lineHeight = 20.sp,
        )
        Spacer(Modifier.height(24.dp))
        PrimaryButton("Add API Key", onClick = onAdd, icon = Icons.Default.Add)
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

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .panel()
            .clickable { onOpenStats() }
            .padding(start = 16.dp, top = 14.dp, end = 6.dp, bottom = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProviderTile(providerId = credential.providerId)

            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    credential.label,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 16.sp,
                    color = Bone,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Row {
                    Text(
                        provider?.name ?: credential.providerId,
                        style = MonoStyle,
                        color = Dim,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(" · ", style = MonoStyle, color = Dim)
                    CapsText(
                        if (credential.authMethod == AuthMethod.API_KEY) "API Key" else "OAuth",
                        style = MonoStyle,
                        color = if (credential.authMethod == AuthMethod.API_KEY) Fog else Phosphor,
                        maxLines = 1,
                    )
                }
            }

            IconButton(onClick = onRename, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Edit, "Rename", tint = Dim, modifier = Modifier.size(18.dp))
            }

            IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.Delete, "Remove", tint = Dim, modifier = Modifier.size(18.dp))
            }
        }

        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = Seam, modifier = Modifier.padding(end = 10.dp))
        Spacer(Modifier.height(10.dp))

        SectionLabel("Last 7 days")
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
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

@Composable
private fun UsageStat(value: String, label: String) {
    Column {
        Text(value, style = MonoStyle.copy(fontSize = 16.sp, lineHeight = 22.sp), fontWeight = FontWeight.Medium, color = Bone)
        Text(label, style = MonoStyle.copy(fontSize = 11.sp), color = Dim)
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

    RetroBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
        ) {
            CapsText(
                "Add API Key",
                style = HeadingStyle.copy(fontSize = 22.sp, lineHeight = 28.sp),
                color = Bone,
            )

            Spacer(Modifier.height(20.dp))

            SectionLabel("Provider", color = Fog)
            Spacer(Modifier.height(8.dp))

            LazyColumn(
                modifier = Modifier.heightIn(max = 220.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(Provider.all) { provider ->
                    val selected = selectedProvider?.id == provider.id
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
                        color = if (selected) VioletSoft else Void,
                        shape = RectangleShape,
                        border = BorderStroke(1.dp, if (selected) Violet else Seam),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            ProviderTile(providerId = provider.id, size = 32.dp, iconSize = 18.dp)
                            Spacer(Modifier.width(12.dp))
                            Text(provider.name, color = Bone, modifier = Modifier.weight(1f))
                            if (selected) {
                                Icon(Icons.Default.Check, null, tint = Phosphor, modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }

            if (selectedProvider != null) {
                if (supportsSetupToken) {
                    Spacer(Modifier.height(16.dp))
                    SectionLabel("Credential Type", color = Fog)
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CredentialTypeOption(
                            text = "API Key",
                            selected = authMethod == AuthMethod.API_KEY,
                            onClick = { authMethod = AuthMethod.API_KEY },
                            modifier = Modifier.weight(1f),
                        )
                        CredentialTypeOption(
                            text = "Setup Token",
                            selected = authMethod == AuthMethod.OAUTH,
                            onClick = { authMethod = AuthMethod.OAUTH },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }

                Spacer(Modifier.height(16.dp))

                if (needsBaseUrl) {
                    RetroTextField(
                        value = baseUrl,
                        onValueChange = { baseUrl = it },
                        label = if (isLocalProvider) "Server URL" else "Endpoint URL",
                        placeholder = defaultBaseUrlForProvider,
                        mono = true,
                        isError = baseUrl.isNotBlank() && normalizedBaseUrl == null,
                        supportingText = CredentialBaseUrl.requirementText(selectedProvider!!.id),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when (selectedProvider?.id) {
                            "ollama" -> "Where your Ollama server is running. Make sure `ollama serve` is active."
                            "lm_studio" -> "Where your LM Studio server is running. Start the \"Local Server\" in LM Studio."
                            else -> "Your key is only ever sent to this endpoint."
                        },
                        color = Fog,
                        fontSize = 12.sp,
                    )
                    Spacer(Modifier.height(8.dp))
                    if (isLocalProvider) Row(verticalAlignment = Alignment.Top) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = Amber,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "Plain http:// only works for a server on this phone (localhost or 127.0.0.1). A server elsewhere on your network needs https://. Requests fail while the server is offline or asleep.",
                            color = Amber,
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }

                RetroTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = "Label",
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(14.dp))

                RetroTextField(
                    value = apiKey,
                    onValueChange = { apiKey = it; error = null },
                    label = when {
                        authMethod == AuthMethod.OAUTH -> "Setup Token"
                        isLocalProvider -> "API Key (optional)"
                        else -> "API Key"
                    },
                    mono = true,
                    secret = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                )

                if (authMethod == AuthMethod.OAUTH) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Run `claude setup-token` in your terminal to get a token. Setup tokens use your Claude Pro/Max subscription.",
                        color = Fog,
                        fontSize = 12.sp,
                    )
                } else if (isLocalProvider) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Leave blank if your local server has no auth. Any key you enter is stored encrypted on-device and forwarded as a Bearer token.",
                        color = Fog,
                        fontSize = 12.sp,
                    )
                } else {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Your key will be encrypted with AES-256-GCM and stored securely. It never leaves this device.",
                        color = Fog,
                        fontSize = 12.sp,
                    )
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Alarm, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            val isValid = selectedProvider != null && label.isNotBlank() &&
                (!needsBaseUrl || normalizedBaseUrl != null) &&
                (isLocalProvider || apiKey.isNotBlank())

            PrimaryButton(
                if (saving) "Encrypting…" else "Save",
                onClick = {
                    if (saving) return@PrimaryButton
                    error = null
                    val providerId = selectedProvider!!.id
                    // Keys travel in an HTTP header: printable ASCII only.
                    val cleanKey = ApiKeyFormat.normalize(apiKey.filter { !it.isWhitespace() })
                    if (cleanKey == null) {
                        error = ApiKeyFormat.INVALID_MESSAGE
                        return@PrimaryButton
                    }
                    saving = true
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
                busy = saving,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            )
        }
    }
}

/** One half of the API key / setup token toggle. */
@Composable
private fun CredentialTypeOption(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        selected = selected,
        onClick = onClick,
        modifier = modifier.heightIn(min = 44.dp),
        shape = RectangleShape,
        color = if (selected) VioletSoft else Color.Transparent,
        border = BorderStroke(1.dp, if (selected) Violet else SeamStrong),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(vertical = 12.dp)) {
            CapsText(
                text,
                style = MonoLabelStyle.copy(fontSize = 12.sp),
                color = if (selected) Lilac else Fog,
            )
        }
    }
}
