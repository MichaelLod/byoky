package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class PasswordQualityResult(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val message: String,
    val color: Color,
    val isAcceptable: Boolean,
) {
    companion object {
        fun evaluate(password: String): PasswordQualityResult {
            if (password.length < 12) return PasswordQualityResult(Icons.Default.Warning, "Minimum 12 characters", Color(0xFFFB923C), false)
            if (password.toSet().size < 4) return PasswordQualityResult(Icons.Default.Warning, "Too many repeated characters", Color(0xFFFB923C), false)
            val hasLower = password.any { it.isLowerCase() }
            val hasUpper = password.any { it.isUpperCase() }
            val hasDigit = password.any { it.isDigit() }
            val hasSymbol = password.any { !it.isLetterOrDigit() }
            val classCount = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }
            if (classCount < 2) return PasswordQualityResult(Icons.Default.Warning, "Use a mix of letters, numbers, or symbols", Color(0xFFFB923C), false)
            if (classCount >= 3 && password.length >= 16) return PasswordQualityResult(Icons.Default.Shield, "Strong password", Success, true)
            return PasswordQualityResult(Icons.Default.CheckCircle, "Fair — consider adding more variety", Color(0xFFFACC15), true)
        }
    }
}

private enum class Mode { VAULT, BYOK }
private enum class Step { CREDENTIALS, CONFIRM }
private enum class UsernameStatus { IDLE, CHECKING, AVAILABLE, TAKEN, INVALID }

private val usernamePattern = Regex("^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$")

@Composable
fun OnboardingScreen(wallet: WalletStore) {
    var mode by remember { mutableStateOf(Mode.VAULT) }
    var step by remember { mutableStateOf(Step.CREDENTIALS) }
    var isSignup by remember { mutableStateOf(true) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var usernameStatus by remember { mutableStateOf(UsernameStatus.IDLE) }
    val scope = rememberCoroutineScope()
    var checkJob by remember { mutableStateOf<Job?>(null) }

    fun resetFields() {
        password = ""
        confirmPassword = ""
        username = ""
        error = null
        usernameStatus = UsernameStatus.IDLE
        step = Step.CREDENTIALS
    }

    fun scheduleUsernameCheck(raw: String) {
        checkJob?.cancel()
        val trimmed = raw.lowercase().trim()
        when {
            trimmed.length < 3 -> usernameStatus = UsernameStatus.IDLE
            !usernamePattern.matches(trimmed) -> usernameStatus = UsernameStatus.INVALID
            else -> {
                usernameStatus = UsernameStatus.CHECKING
                checkJob = scope.launch {
                    delay(400)
                    val (available, reason) = withContext(Dispatchers.IO) {
                        wallet.checkUsernameAvailability(trimmed)
                    }
                    usernameStatus = when {
                        available -> UsernameStatus.AVAILABLE
                        reason == "invalid" -> UsernameStatus.INVALID
                        else -> UsernameStatus.TAKEN
                    }
                }
            }
        }
    }

    fun doSubmit() {
        loading = true
        error = null
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    wallet.createPassword(password)
                    if (mode == Mode.VAULT) {
                        val trimmed = username.lowercase().trim()
                        wallet.enableCloudVault(trimmed, password, isSignup)
                    }
                }
            } catch (e: Exception) {
                error = e.message ?: "Failed to create wallet"
            } finally {
                loading = false
            }
        }
    }

    val quality = if (password.isNotEmpty()) PasswordQualityResult.evaluate(password) else null
    val canContinue = !loading &&
        password.length >= 12 &&
        (!isSignup || quality?.isAcceptable == true) &&
        (mode != Mode.VAULT || username.isNotEmpty()) &&
        (mode != Mode.VAULT || !isSignup || (usernameStatus != UsernameStatus.TAKEN && usernameStatus != UsernameStatus.INVALID))

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = Accent,
        unfocusedBorderColor = Border,
        focusedContainerColor = BgRaised,
        unfocusedContainerColor = BgRaised,
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgMain)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        if (step == Step.CONFIRM) {
            // ── Confirm password step ──
            Text("Byoky", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(12.dp))
            Text("Confirm your password", color = TextSecondary, textAlign = TextAlign.Center)

            Spacer(Modifier.height(24.dp))

            error?.let {
                Text(it, color = Danger, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
            }

            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("Repeat your password") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = fieldColors,
                shape = RoundedCornerShape(12.dp),
            )

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = {
                    error = null
                    if (password != confirmPassword) {
                        error = "Passwords do not match"
                    } else {
                        doSubmit()
                    }
                },
                enabled = confirmPassword.isNotEmpty() && !loading,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text(if (loading) "Creating..." else "Create Wallet", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }

            Spacer(Modifier.height(14.dp))

            TextButton(onClick = { step = Step.CREDENTIALS; confirmPassword = ""; error = null }) {
                Text("Back", color = TextMuted, fontSize = 12.sp, textDecoration = TextDecoration.Underline)
            }
        } else {
            // ── Main credentials step ──
            Text("Byoky", fontSize = 32.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(8.dp))
            Text("One wallet.\nEvery AI app.", color = TextSecondary, textAlign = TextAlign.Center)

            Spacer(Modifier.height(24.dp))

            if (mode == Mode.VAULT) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Button(
                        onClick = { isSignup = true; resetFields() },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isSignup) Accent else BgRaised,
                            contentColor = if (isSignup) Color.White else TextSecondary,
                        ),
                    ) {
                        Text("Sign Up", fontSize = 13.sp)
                    }
                    Button(
                        onClick = { isSignup = false; resetFields() },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (!isSignup) Accent else BgRaised,
                            contentColor = if (!isSignup) Color.White else TextSecondary,
                        ),
                    ) {
                        Text("Log In", fontSize = 13.sp)
                    }
                }
                Spacer(Modifier.height(14.dp))
            }

            if (mode == Mode.BYOK) {
                Text(
                    "Create a local password\nto encrypt your API keys.",
                    color = TextSecondary,
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(14.dp))
            }

            error?.let {
                Text(it, color = Danger, fontSize = 12.sp)
                Spacer(Modifier.height(8.dp))
            }

            if (mode == Mode.VAULT) {
                OutlinedTextField(
                    value = username,
                    onValueChange = { value ->
                        username = value
                        if (isSignup) scheduleUsernameCheck(value)
                    },
                    label = { Text("Username") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    colors = fieldColors,
                    shape = RoundedCornerShape(12.dp),
                )

                if (isSignup && username.length >= 3) {
                    Spacer(Modifier.height(4.dp))
                    val statusMessage = when (usernameStatus) {
                        UsernameStatus.CHECKING -> "Checking availability..."
                        UsernameStatus.AVAILABLE -> "Username is available"
                        UsernameStatus.TAKEN -> "Username is already taken"
                        UsernameStatus.INVALID -> "Letters, numbers, hyphens, underscores (3-30 chars)"
                        UsernameStatus.IDLE -> ""
                    }
                    val statusColor = when (usernameStatus) {
                        UsernameStatus.AVAILABLE -> Success
                        UsernameStatus.TAKEN, UsernameStatus.INVALID -> Danger
                        else -> TextMuted
                    }
                    Text(statusMessage, color = statusColor, fontSize = 11.sp, modifier = Modifier.align(Alignment.Start))
                }

                Spacer(Modifier.height(10.dp))
            }

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(if (isSignup) "Password, 12 characters" else "Password") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = fieldColors,
                shape = RoundedCornerShape(12.dp),
            )

            if (isSignup && quality != null) {
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(quality.icon, null, tint = quality.color, modifier = Modifier.size(14.dp))
                    Text(quality.message, color = quality.color, fontSize = 12.sp)
                }
            }

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = {
                    error = null
                    if (!isSignup) {
                        doSubmit()
                    } else {
                        step = Step.CONFIRM
                        error = null
                    }
                },
                enabled = canContinue,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text(
                    when {
                        loading -> "Connecting..."
                        isSignup -> "Continue"
                        else -> "Log In"
                    },
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
            }

            Spacer(Modifier.height(16.dp))

            TextButton(onClick = {
                mode = if (mode == Mode.VAULT) Mode.BYOK else Mode.VAULT
                resetFields()
                isSignup = true
            }) {
                Text(
                    if (mode == Mode.VAULT) "Got API keys? Add them here" else "← Back to Vault signup",
                    color = TextMuted,
                    fontSize = 12.sp,
                    textDecoration = TextDecoration.Underline,
                )
            }
        }

        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(32.dp))
    }
}
