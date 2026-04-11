package com.byoky.app.ui.screens

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

internal enum class VaultAuthMode { SIGNUP, LOGIN, UNKNOWN }

private val usernamePattern = Regex("^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$")

@Composable
fun VaultAuthContent(wallet: WalletStore, onBack: () -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf(VaultUsernameStatus.IDLE) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var checkJob by remember { mutableStateOf<Job?>(null) }

    val mode = when (status) {
        VaultUsernameStatus.AVAILABLE -> VaultAuthMode.SIGNUP
        VaultUsernameStatus.TAKEN -> VaultAuthMode.LOGIN
        else -> VaultAuthMode.UNKNOWN
    }

    val buttonLabel = when {
        loading -> "Connecting..."
        status == VaultUsernameStatus.CHECKING -> "Checking username..."
        mode == VaultAuthMode.SIGNUP -> "Create account"
        mode == VaultAuthMode.LOGIN -> "Sign in"
        else -> "Continue"
    }

    val quality = if (password.isNotEmpty()) PasswordQualityResult.evaluate(password) else null
    val canSubmit = !loading && username.length >= 3 && password.isNotEmpty() && when (mode) {
        VaultAuthMode.SIGNUP -> password.length >= 12 && quality?.isAcceptable == true
        VaultAuthMode.LOGIN -> true
        VaultAuthMode.UNKNOWN -> false
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

        Spacer(Modifier.height(8.dp))

        Text(
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
            label = { Text("Username") },
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
            val statusMessage = when (status) {
                VaultUsernameStatus.CHECKING -> "Checking..."
                VaultUsernameStatus.AVAILABLE -> "Available — creating a new account"
                VaultUsernameStatus.TAKEN -> "Existing account — signing in"
                VaultUsernameStatus.INVALID -> "Letters, numbers, hyphens, underscores only (3-30 chars)"
                VaultUsernameStatus.IDLE -> ""
            }
            val statusColor = when (status) {
                VaultUsernameStatus.AVAILABLE -> Success
                VaultUsernameStatus.INVALID -> Danger
                else -> TextMuted
            }
            Text(statusMessage, color = statusColor, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start))
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
                            VaultAuthMode.UNKNOWN -> {}
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
