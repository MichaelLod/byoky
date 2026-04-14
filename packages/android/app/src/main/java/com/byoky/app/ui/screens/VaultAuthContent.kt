package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.MascotView
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal enum class VaultUsernameStatus { IDLE, CHECKING, AVAILABLE, TAKEN, INVALID }

enum class VaultAuthMode { SIGNUP, LOGIN }

private val usernamePattern = Regex("^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$")

@Composable
private fun ModeTab(selected: Boolean, label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clickable(onClick = onClick)
            .background(
                if (selected) BgCard else androidx.compose.ui.graphics.Color.Transparent,
                shape = RoundedCornerShape(7.dp),
            )
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (selected) TextPrimary else TextMuted,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

@Composable
fun VaultAuthContent(wallet: WalletStore, initialMode: VaultAuthMode, onBack: () -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf(VaultUsernameStatus.IDLE) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var mode by remember { mutableStateOf(initialMode) }
    val scope = rememberCoroutineScope()
    var checkJob by remember { mutableStateOf<Job?>(null) }

    val buttonLabel = when {
        loading -> "Connecting..."
        status == VaultUsernameStatus.CHECKING -> "Checking username..."
        mode == VaultAuthMode.SIGNUP -> "Create account"
        else -> "Sign in"
    }

    val quality = if (password.isNotEmpty()) PasswordQualityResult.evaluate(password) else null
    val canSubmit = !loading && username.length >= 3 && password.isNotEmpty() && when (mode) {
        VaultAuthMode.SIGNUP -> status == VaultUsernameStatus.AVAILABLE && password.length >= 12 && quality?.isAcceptable == true
        VaultAuthMode.LOGIN -> status == VaultUsernameStatus.TAKEN
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth(),
    ) {
        MascotView(modifier = Modifier.size(100.dp))

        Spacer(Modifier.height(20.dp))

        Text(
            "Your vault, your keys",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )

        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgRaised, shape = RoundedCornerShape(10.dp))
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            ModeTab(
                selected = mode == VaultAuthMode.SIGNUP,
                label = "Create account",
                onClick = { mode = VaultAuthMode.SIGNUP; error = null },
                modifier = Modifier.weight(1f),
            )
            ModeTab(
                selected = mode == VaultAuthMode.LOGIN,
                label = "Sign in",
                onClick = { mode = VaultAuthMode.LOGIN; error = null },
                modifier = Modifier.weight(1f),
            )
        }

        Spacer(Modifier.height(12.dp))

        Text(
            if (mode == VaultAuthMode.LOGIN)
                "Sign in to sync keys from Cloud Sync."
            else
                "End-to-end encrypted with your password. We can't read your keys.",
            color = TextSecondary,
            textAlign = TextAlign.Center,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 16.dp),
        )

        Spacer(Modifier.height(20.dp))

        OutlinedTextField(
            value = username,
            onValueChange = { value ->
                username = value
                error = null
                checkJob?.cancel()
                val trimmed = value.lowercase().trim()
                when {
                    trimmed.length < 3 -> status = VaultUsernameStatus.IDLE
                    !usernamePattern.matches(trimmed) -> status = VaultUsernameStatus.INVALID
                    else -> {
                        status = VaultUsernameStatus.CHECKING
                        checkJob = scope.launch {
                            delay(400)
                            val (available, reason) = wallet.checkUsernameAvailability(trimmed)
                            status = when {
                                available -> VaultUsernameStatus.AVAILABLE
                                reason == "invalid" -> VaultUsernameStatus.INVALID
                                else -> VaultUsernameStatus.TAKEN
                            }
                        }
                    }
                }
            },
            label = { Text(if (mode == VaultAuthMode.LOGIN) "Your username" else "Choose a username") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                unfocusedBorderColor = Border,
                focusedContainerColor = BgRaised,
                unfocusedContainerColor = BgRaised,
            ),
            shape = RoundedCornerShape(12.dp),
        )

        if (username.length >= 3) {
            Spacer(Modifier.height(4.dp))
            when {
                status == VaultUsernameStatus.CHECKING ->
                    Text("Checking...", color = TextMuted, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start))
                status == VaultUsernameStatus.INVALID ->
                    Text(
                        "Letters, numbers, hyphens, underscores only (3-30 chars)",
                        color = Danger, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start),
                    )
                mode == VaultAuthMode.SIGNUP && status == VaultUsernameStatus.AVAILABLE ->
                    Text("Available", color = Success, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start))
                mode == VaultAuthMode.LOGIN && status == VaultUsernameStatus.TAKEN ->
                    Text("Account found", color = Success, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start))
                mode == VaultAuthMode.SIGNUP && status == VaultUsernameStatus.TAKEN ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.align(Alignment.Start),
                    ) {
                        Text("Already taken.", color = Danger, fontSize = 11.sp)
                        TextButton(
                            onClick = { mode = VaultAuthMode.LOGIN },
                            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                        ) {
                            Text("Sign in instead", color = Accent, fontSize = 11.sp)
                        }
                    }
                mode == VaultAuthMode.LOGIN && status == VaultUsernameStatus.AVAILABLE ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.align(Alignment.Start),
                    ) {
                        Text("No account with this username.", color = Danger, fontSize = 11.sp)
                        TextButton(
                            onClick = { mode = VaultAuthMode.SIGNUP },
                            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 0.dp),
                        ) {
                            Text("Create one", color = Accent, fontSize = 11.sp)
                        }
                    }
                else -> {}
            }
        }

        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(if (mode == VaultAuthMode.LOGIN) "Your password" else "At least 12 characters") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                unfocusedBorderColor = Border,
                focusedContainerColor = BgRaised,
                unfocusedContainerColor = BgRaised,
            ),
            shape = RoundedCornerShape(12.dp),
        )

        if (mode == VaultAuthMode.SIGNUP && quality != null) {
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(quality.icon, null, tint = quality.color, modifier = Modifier.size(14.dp))
                Text(quality.message, color = quality.color, fontSize = 12.sp)
            }
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Danger, fontSize = 12.sp)
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = {
                val trimmed = username.lowercase().trim()
                loading = true
                error = null
                scope.launch {
                    try {
                        when (mode) {
                            VaultAuthMode.SIGNUP -> wallet.vaultBootstrapSignup(trimmed, password)
                            VaultAuthMode.LOGIN -> wallet.vaultBootstrapLogin(trimmed, password)
                        }
                    } catch (e: Exception) {
                        error = e.message ?: "Failed to connect to vault"
                    } finally {
                        loading = false
                    }
                }
            },
            enabled = canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                disabledContainerColor = Accent.copy(alpha = 0.3f),
            ),
        ) {
            Text(buttonLabel, fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.height(8.dp))

        TextButton(onClick = onBack) {
            Text("← Back", color = TextSecondary)
        }
    }
}
