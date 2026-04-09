package com.byoky.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.BuildConfig
import com.byoky.app.data.DEFAULT_GROUP_ID
import com.byoky.app.data.Provider
import com.byoky.app.data.WalletStore
import com.byoky.app.proxy.TranslationEngine
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(wallet: WalletStore) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cloudVaultEnabled by wallet.cloudVaultEnabled.collectAsState()
    val cloudVaultUsername by wallet.cloudVaultUsername.collectAsState()
    val cloudVaultTokenExpired by wallet.cloudVaultTokenExpired.collectAsState()
    var showCloudVaultSetup by remember { mutableStateOf(false) }
    var showCloudVaultRelogin by remember { mutableStateOf(false) }
    var showRoutingEditor by remember { mutableStateOf(false) }
    val groups by wallet.groups.collectAsState()
    val defaultGroup = groups.firstOrNull { it.id == DEFAULT_GROUP_ID }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
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
            // Firefox Extension
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Extension, null, tint = Accent, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("Firefox Extension", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Install the Byoky extension for Firefox on Android to proxy requests from websites. Chrome on Android doesn't support extensions.",
                        color = TextSecondary,
                        fontSize = 14.sp,
                    )
                }
            }

            // Routing — cross-family translation destination
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Surface(
                    onClick = { showRoutingEditor = true },
                    color = BgCard,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(modifier = Modifier.padding(20.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.AltRoute, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text("Cross-family routing", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        }
                        Spacer(Modifier.height(8.dp))
                        if (defaultGroup != null) {
                            val providerName = Provider.find(defaultGroup.providerId)?.name ?: defaultGroup.providerId
                            val model = defaultGroup.model
                            if (!model.isNullOrEmpty()) {
                                Text("Routing to: $providerName · $model", color = TextSecondary, fontSize = 13.sp)
                            } else {
                                Text("Pass-through (no model configured)", color = TextSecondary, fontSize = 13.sp)
                            }
                        } else {
                            Text("Tap to configure", color = TextSecondary, fontSize = 13.sp)
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            "When apps request a different provider family, route them here. Same-family requests pass through unchanged.",
                            color = TextMuted,
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            // Cloud Vault
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Cloud, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text("Cloud Vault", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        }
                        Switch(
                            checked = cloudVaultEnabled,
                            onCheckedChange = { enabled ->
                                if (enabled) {
                                    showCloudVaultSetup = true
                                } else {
                                    scope.launch { wallet.disableCloudVault() }
                                }
                            },
                            colors = SwitchDefaults.colors(checkedTrackColor = Accent),
                        )
                    }

                    if (cloudVaultEnabled) {
                        cloudVaultUsername?.let { username ->
                            Spacer(Modifier.height(8.dp))
                            Text("Synced as $username", color = TextMuted, fontSize = 12.sp)
                        }
                        if (cloudVaultTokenExpired) {
                            Spacer(Modifier.height(8.dp))
                            Surface(
                                onClick = { showCloudVaultRelogin = true },
                                color = BgCard,
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(Icons.Default.Warning, null, tint = Warning, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text("Session expired — tap to re-login", color = Warning, fontSize = 13.sp)
                                }
                            }
                        }
                    } else {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Websites can use your keys even when this device is offline.",
                            color = TextSecondary,
                            fontSize = 14.sp,
                        )
                    }
                }
            }

            // Security
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("Security", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    Spacer(Modifier.height(16.dp))

                    Surface(
                        onClick = { wallet.lock() },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Lock, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("Lock Wallet", color = TextPrimary)
                        }
                    }

                    Spacer(Modifier.height(12.dp))

                    InfoRow("Encryption", "AES-256-GCM")
                    InfoRow("Key Derivation", "PBKDF2 (600K)")
                    InfoRow("Storage", "EncryptedSharedPreferences")
                }
            }

            // Translation engine debug — only shown in debug builds.
            if (BuildConfig.DEBUG) {
                TranslationDebugCard()
            }

            // About
            Card(
                colors = CardDefaults.cardColors(containerColor = BgCard),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(modifier = Modifier.padding(20.dp)) {
                    Text("About", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    Spacer(Modifier.height(16.dp))

                    InfoRow("Version", "1.0.0")

                    Spacer(Modifier.height(8.dp))

                    Surface(
                        onClick = {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/MichaelLod/byoky"))
                            )
                        },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Code, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("GitHub", color = TextPrimary)
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        }
                    }

                    Spacer(Modifier.height(4.dp))

                    Surface(
                        onClick = {
                            context.startActivity(
                                Intent(Intent.ACTION_VIEW, Uri.parse("https://byoky.com"))
                            )
                        },
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Language, null, tint = Accent, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(12.dp))
                            Text("Website", color = TextPrimary)
                            Spacer(Modifier.weight(1f))
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }

    if (showCloudVaultSetup) {
        CloudVaultSetupDialog(
            wallet = wallet,
            onDismiss = { showCloudVaultSetup = false },
        )
    }

    if (showRoutingEditor) {
        GroupEditorDialog(
            wallet = wallet,
            onDismiss = { showRoutingEditor = false },
        )
    }

    if (showCloudVaultRelogin) {
        CloudVaultReloginDialog(
            wallet = wallet,
            onDismiss = { showCloudVaultRelogin = false },
        )
    }
}

@Composable
fun CloudVaultSetupDialog(wallet: WalletStore, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf("warning") } // "warning" or "auth"
    var understood by remember { mutableStateOf(false) }
    var isSignup by remember { mutableStateOf(true) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val usernameRegex = remember { Regex("^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$") }
    val isUsernameValid = username.lowercase().trim().matches(usernameRegex)
    var usernameStatus by remember { mutableStateOf("idle") } // idle, checking, available, taken, invalid
    var checkJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }

    fun checkUsernameAvailability(value: String) {
        checkJob?.cancel()
        val trimmed = value.lowercase().trim()
        if (trimmed.length < 3) { usernameStatus = "idle"; return }
        if (!trimmed.matches(usernameRegex)) { usernameStatus = "invalid"; return }
        usernameStatus = "checking"
        checkJob = scope.launch {
            kotlinx.coroutines.delay(400)
            val (available, reason) = wallet.checkUsernameAvailability(trimmed)
            if (!coroutineContext[kotlinx.coroutines.Job]!!.isActive) return@launch
            usernameStatus = if (available) "available" else if (reason == "invalid") "invalid" else "taken"
        }
    }

    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        containerColor = BgCard,
        title = {
            Text(
                when (step) {
                    "warning" -> "Cloud Vault"
                    else -> if (isSignup) "Create Vault Account" else "Login to Vault"
                },
                color = TextPrimary,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (step == "warning") {
                    Text(
                        "Cloud Vault lets websites use your credentials even when this device is offline. Your keys are sent to vault.byoky.com over an encrypted connection and stored with AES-256-GCM encryption.",
                        color = TextSecondary,
                        fontSize = 14.sp,
                    )
                    Text(
                        "Note: your keys will be stored on a remote server.",
                        color = TextMuted,
                        fontSize = 13.sp,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = understood,
                            onCheckedChange = { understood = it },
                            colors = CheckboxDefaults.colors(checkedColor = Accent),
                        )
                        Text(
                            "I understand my keys will be stored remotely",
                            color = TextSecondary,
                            fontSize = 13.sp,
                        )
                    }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = isSignup,
                            onClick = { isSignup = true; error = null },
                            label = { Text("Sign Up") },
                        )
                        FilterChip(
                            selected = !isSignup,
                            onClick = { isSignup = false; error = null },
                            label = { Text("Login") },
                        )
                    }
                    error?.let {
                        Text(it, color = Warning, fontSize = 13.sp)
                    }
                    OutlinedTextField(
                        value = username,
                        onValueChange = {
                            username = it
                            if (isSignup) checkUsernameAvailability(it)
                        },
                        label = { Text("Username") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        isError = isSignup && username.isNotEmpty() && usernameStatus in listOf("taken", "invalid"),
                        supportingText = if (isSignup && username.trim().length >= 3) {
                            {
                                when (usernameStatus) {
                                    "checking" -> Text("Checking availability...", color = TextSecondary)
                                    "available" -> Text("Username is available", color = Success)
                                    "taken" -> Text("Username is already taken", color = Danger)
                                    "invalid" -> Text("Letters, numbers, hyphens, underscores only (3\u201330 chars)", color = Danger)
                                    else -> {}
                                }
                            }
                        } else null,
                    )
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                }
            }
        },
        confirmButton = {
            if (step == "warning") {
                TextButton(
                    onClick = { step = "auth" },
                    enabled = understood,
                ) { Text("Continue") }
            } else {
                TextButton(
                    onClick = {
                        loading = true
                        error = null
                        scope.launch {
                            try {
                                wallet.enableCloudVault(username, password, isSignup)
                                onDismiss()
                            } catch (e: Exception) {
                                error = e.message
                            }
                            loading = false
                        }
                    },
                    enabled = !loading && username.isNotBlank() && password.isNotBlank() &&
                        (!isSignup || password.length >= 12) &&
                        (!isSignup || (isUsernameValid && usernameStatus !in listOf("taken", "invalid", "checking"))),
                ) { Text(if (loading) "Connecting..." else if (isSignup) "Sign Up" else "Login") }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !loading) { Text("Cancel") }
        },
    )
}

@Composable
private fun CloudVaultReloginDialog(wallet: WalletStore, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val username by wallet.cloudVaultUsername.collectAsState()
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!loading) onDismiss() },
        containerColor = BgCard,
        title = { Text("Re-login to Cloud Vault", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Your session has expired. Enter your vault password to reconnect.",
                    color = TextSecondary,
                    fontSize = 14.sp,
                )
                error?.let {
                    Text(it, color = Warning, fontSize = 13.sp)
                }
                OutlinedTextField(
                    value = username ?: "",
                    onValueChange = {},
                    label = { Text("Username") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = false,
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            wallet.reloginCloudVault(password)
                            onDismiss()
                        } catch (e: Exception) {
                            error = e.message
                        }
                        loading = false
                    }
                },
                enabled = !loading && password.isNotBlank(),
            ) { Text(if (loading) "Logging in..." else "Login") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !loading) { Text("Cancel") }
        },
    )
}

/**
 * Debug-only card that runs the TranslationEngine self-test against the
 * bundled mobile.js. Tap the button → engine warms up, runs the round-trip
 * smoke test from TranslationEngine.runSelfTest(), shows the multi-line
 * report inline. Useful for verifying the bundle loads on a fresh install
 * before bothering with the full instrumented test run.
 */
@Composable
private fun TranslationDebugCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var report by remember { mutableStateOf<String?>(null) }
    var running by remember { mutableStateOf(false) }

    Card(
        colors = CardDefaults.cardColors(containerColor = BgCard),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.BugReport, null, tint = Accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text("Translation Engine (debug)", fontWeight = FontWeight.SemiBold, color = TextPrimary)
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "Verify the @byoky/core JS bundle loads in JavaScriptSandbox and round-trips a real translation.",
                color = TextSecondary,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(12.dp))
            Surface(
                onClick = {
                    if (running) return@Surface
                    running = true
                    report = "Running…"
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            TranslationEngine.get(context).runSelfTest()
                        }
                        report = result
                        running = false
                    }
                },
                color = BgCard,
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.PlayArrow, null, tint = Accent, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Text(if (running) "Running self-test…" else "Run self-test", color = TextPrimary)
                }
            }
            report?.let {
                Spacer(Modifier.height(12.dp))
                Text(
                    it,
                    color = TextSecondary,
                    fontSize = 12.sp,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                )
            }
        }
    }
}

/**
 * Edit the default group's destination provider + model. Mobile uses the
 * default group as a global routing rule (no per-app origin yet), so this
 * dialog is the single point of control for cross-family translation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GroupEditorDialog(wallet: WalletStore, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val groups by wallet.groups.collectAsState()
    val current = groups.firstOrNull { it.id == DEFAULT_GROUP_ID }
    var providerId by remember { mutableStateOf(current?.providerId ?: "anthropic") }
    var model by remember { mutableStateOf(current?.model ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var providerExpanded by remember { mutableStateOf(false) }
    val providerName = Provider.find(providerId)?.name ?: providerId

    // Pull known models + capability summary from the @byoky/core registry
    // via the JS bridge. Empty list / null summary means the registry has
    // no entries — the user can still type a custom model name.
    val engine = remember { TranslationEngine.get(context) }
    val suggestedModels = remember(providerId, engine.isSupported) {
        if (!engine.isSupported) return@remember emptyList<Pair<String, String>>()
        try {
            val json = org.json.JSONArray(engine.getModelsForProvider(providerId))
            (0 until json.length()).map { i ->
                val obj = json.getJSONObject(i)
                obj.getString("id") to obj.getString("displayName")
            }
        } catch (_: Throwable) { emptyList() }
    }
    val modelInfo = remember(model, engine.isSupported) {
        if (!engine.isSupported || model.isEmpty()) return@remember null as String?
        try {
            val raw = engine.describeModel(model) ?: return@remember null as String?
            val parsed = org.json.JSONObject(raw)
            val caps = parsed.getJSONObject("capabilities")
            val bits = buildList {
                if (caps.optBoolean("tools")) add("tools")
                if (caps.optBoolean("vision")) add("vision")
                if (caps.optBoolean("structuredOutput")) add("JSON schema")
                if (caps.optBoolean("reasoning")) add("reasoning")
            }
            val display = parsed.optString("displayName", model)
            val ctx = parsed.optInt("contextWindow", 0)
            val ctxK = if (ctx >= 1000) "${ctx / 1000}K" else "$ctx"
            "$display: $ctxK ctx · ${bits.joinToString(" · ")}"
        } catch (_: Throwable) { null }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Cross-family routing", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "When apps request a different provider family, route the call through this destination instead. Same-family requests pass through unchanged. Leave model empty to disable routing.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                )

                ExposedDropdownMenuBox(
                    expanded = providerExpanded,
                    onExpandedChange = { providerExpanded = !providerExpanded },
                ) {
                    OutlinedTextField(
                        value = providerName,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Destination provider") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = providerExpanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(),
                    )
                    ExposedDropdownMenu(
                        expanded = providerExpanded,
                        onDismissRequest = { providerExpanded = false },
                    ) {
                        Provider.all.forEach { provider ->
                            DropdownMenuItem(
                                text = { Text(provider.name) },
                                onClick = {
                                    providerId = provider.id
                                    providerExpanded = false
                                },
                            )
                        }
                    }
                }

                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Destination model (e.g. gpt-4o)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )

                if (modelInfo != null) {
                    Text(modelInfo, color = TextMuted, fontSize = 12.sp)
                }

                if (suggestedModels.isNotEmpty()) {
                    Text("Suggested models", color = TextMuted, fontSize = 11.sp)
                    suggestedModels.forEach { (id, name) ->
                        Surface(
                            onClick = { model = id },
                            color = BgMain,
                            shape = RoundedCornerShape(6.dp),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(name, color = TextPrimary, fontSize = 12.sp)
                                Text(id, color = TextMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }

                error?.let {
                    Text(it, color = Danger, fontSize = 13.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    try {
                        wallet.updateGroup(
                            id = DEFAULT_GROUP_ID,
                            providerId = providerId,
                            model = model.takeIf { it.isNotEmpty() },
                            unsetModel = model.isEmpty(),
                        )
                        onDismiss()
                    } catch (t: Throwable) {
                        error = t.message ?: "Failed to update routing"
                    }
                },
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = TextSecondary, fontSize = 14.sp)
        Text(value, color = TextPrimary, fontSize = 14.sp)
    }
}
