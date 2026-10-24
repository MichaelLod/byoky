package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.AppUrl
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*

/** The Apps tab: the user's installed web apps plus "Add app". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InstalledAppsScreen(
    wallet: WalletStore,
    onOpenApp: (InstalledApp) -> Unit,
    onAddApp: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Apps") },
                actions = {
                    IconButton(onClick = onAddApp) {
                        Icon(Icons.Default.Add, contentDescription = "Add app", tint = Accent)
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
        InstalledAppsGrid(
            wallet = wallet,
            onOpenApp = onOpenApp,
            onAddApp = onAddApp,
            modifier = Modifier.padding(padding),
        )
    }
}

/**
 * "Add app by URL". Only https addresses are accepted (a bare host such as
 * `app.example.com` is treated as https); the name defaults to the host.
 * On success the app is saved and [onAdded] opens it.
 */
@Composable
internal fun AddAppDialog(
    wallet: WalletStore,
    onDismiss: () -> Unit,
    onAdded: (InstalledApp) -> Unit,
) {
    var url by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val valid = remember(url) { AppUrl.normalize(url) as? AppUrl.Result.Valid }

    fun submit() {
        when (val result = wallet.addAppByUrl(url, name)) {
            is WalletStore.AddAppResult.Added -> onAdded(result.app)
            is WalletStore.AddAppResult.Rejected -> error = result.reason
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgCard,
        title = { Text("Add app", color = TextPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Enter the address of a web app that supports Byoky. It opens inside the wallet, and your keys never leave this device.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it; error = null },
                    label = { Text("App URL") },
                    placeholder = { Text("https://app.example.com") },
                    singleLine = true,
                    isError = error != null,
                    supportingText = valid?.let { v -> { Text("Opens ${v.origin.removePrefix("https://")}", color = TextMuted) } },
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Next,
                        autoCorrectEnabled = false,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name (optional)") },
                    placeholder = { Text(valid?.suggestedName ?: "App name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                val sharedHost = valid?.origin?.removePrefix("https://")?.substringBefore(':')
                if (sharedHost != null && AppUrl.isSharedHosting(sharedHost)) {
                    Text(
                        "$sharedHost is shared hosting. Every page served from it, not just this app, will be able to use your wallet. Only add it if you trust everything published there.",
                        color = Warning,
                        fontSize = 12.sp,
                    )
                }
                error?.let { Text(it, color = Danger, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton(onClick = { submit() }, enabled = url.isNotBlank()) { Text("Add and open") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
