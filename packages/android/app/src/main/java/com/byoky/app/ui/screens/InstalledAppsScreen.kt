package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.AppUrl
import com.byoky.app.data.InstalledApp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.RetroTopBar
import com.byoky.app.ui.components.dotGrid
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
        modifier = Modifier
            .background(Void)
            .dotGrid(),
        topBar = {
            RetroTopBar(
                title = "Apps",
                actions = {
                    IconButton(onClick = onAddApp) {
                        Icon(Icons.Default.Add, contentDescription = "Add app", tint = Phosphor)
                    }
                },
            )
        },
        containerColor = Color.Transparent,
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

    RetroDialog(
        onDismissRequest = onDismiss,
        title = "Add app",
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(
                    "Enter the address of a web app that supports Byoky. It opens inside the wallet, and your keys never leave this device.",
                    fontSize = 13.sp,
                )
                RetroTextField(
                    value = url,
                    onValueChange = { url = it; error = null },
                    label = "App URL",
                    placeholder = "https://app.example.com",
                    mono = true,
                    isError = error != null,
                    supportingText = valid?.let { v -> "Opens ${v.origin.removePrefix("https://")}" },
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Next,
                        autoCorrectEnabled = false,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                RetroTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = "Name (optional)",
                    placeholder = valid?.suggestedName ?: "App name",
                    modifier = Modifier.fillMaxWidth(),
                )
                val sharedHost = valid?.origin?.removePrefix("https://")?.substringBefore(':')
                if (sharedHost != null && AppUrl.isSharedHosting(sharedHost)) {
                    Text(
                        "$sharedHost is shared hosting. Every page served from it, not just this app, will be able to use your wallet. Only add it if you trust everything published there.",
                        color = Amber,
                        fontSize = 12.sp,
                    )
                }
                error?.let { Text(it, color = Alarm, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            DialogButton("Add and open", onClick = { submit() }, enabled = url.isNotBlank())
        },
        dismissButton = {
            DialogButton("Cancel", onClick = onDismiss, color = Fog)
        },
    )
}
