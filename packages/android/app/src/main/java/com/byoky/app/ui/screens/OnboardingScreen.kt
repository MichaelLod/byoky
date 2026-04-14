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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.MascotView
import com.byoky.app.ui.theme.*

internal data class PasswordQualityResult(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val message: String,
    val color: androidx.compose.ui.graphics.Color,
    val isAcceptable: Boolean,
) {
    companion object {
        fun evaluate(password: String): PasswordQualityResult {
            if (password.length < 12) return PasswordQualityResult(Icons.Default.Warning, "Minimum 12 characters", androidx.compose.ui.graphics.Color(0xFFFB923C), false)
            if (password.toSet().size < 4) return PasswordQualityResult(Icons.Default.Warning, "Too many repeated characters", androidx.compose.ui.graphics.Color(0xFFFB923C), false)
            val hasLower = password.any { it.isLowerCase() }
            val hasUpper = password.any { it.isUpperCase() }
            val hasDigit = password.any { it.isDigit() }
            val hasSymbol = password.any { !it.isLetterOrDigit() }
            val classCount = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }
            if (classCount < 2) return PasswordQualityResult(Icons.Default.Warning, "Use a mix of letters, numbers, or symbols", androidx.compose.ui.graphics.Color(0xFFFB923C), false)
            if (classCount >= 3 && password.length >= 16) return PasswordQualityResult(Icons.Default.Shield, "Strong password", Success, true)
            return PasswordQualityResult(Icons.Default.CheckCircle, "Fair — consider adding more variety", androidx.compose.ui.graphics.Color(0xFFFACC15), true)
        }
    }
}

private enum class OnboardingStep { WELCOME, VAULT_AUTH, OFFLINE_SETUP }

@Composable
fun OnboardingScreen(wallet: WalletStore) {
    var step by remember { mutableStateOf(OnboardingStep.WELCOME) }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var vaultMode by remember { mutableStateOf(VaultAuthMode.SIGNUP) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgMain)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        if (step == OnboardingStep.WELCOME) {
            MascotView(modifier = Modifier.size(140.dp))

            Spacer(Modifier.height(24.dp))

            Text(
                "Byoky Wallet",
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )

            Spacer(Modifier.height(12.dp))

            Text(
                "Your encrypted wallet for AI API keys. Sync across devices, end-to-end encrypted.",
                color = TextSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            Spacer(Modifier.height(32.dp))

            Button(
                onClick = {
                    vaultMode = VaultAuthMode.SIGNUP
                    step = OnboardingStep.VAULT_AUTH
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Text("Create account", fontWeight = FontWeight.SemiBold)
            }

            Spacer(Modifier.height(8.dp))

            OutlinedButton(
                onClick = {
                    vaultMode = VaultAuthMode.LOGIN
                    step = OnboardingStep.VAULT_AUTH
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Sign in", fontWeight = FontWeight.SemiBold, color = TextPrimary)
            }

            Spacer(Modifier.height(8.dp))

            TextButton(onClick = { step = OnboardingStep.OFFLINE_SETUP }) {
                Text("Continue in offline mode", color = TextMuted, fontSize = 12.sp)
            }
        } else if (step == OnboardingStep.VAULT_AUTH) {
            VaultAuthContent(
                wallet = wallet,
                initialMode = vaultMode,
                onBack = { step = OnboardingStep.WELCOME },
            )
        } else {
            // Password step
            MascotView(
                modifier = Modifier.size(100.dp),
            )

            Spacer(Modifier.height(24.dp))

            Text(
                "Set Master Password",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                "This password encrypts all your API keys. It's never stored — only a hash is kept to verify unlock.",
                color = TextSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            Spacer(Modifier.height(24.dp))

            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Master password") },
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

            Spacer(Modifier.height(12.dp))

            OutlinedTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = { Text("Confirm password") },
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

            if (password.isNotEmpty()) {
                val quality = PasswordQualityResult.evaluate(password)
                Spacer(Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(quality.icon, null, tint = quality.color, modifier = Modifier.size(14.dp))
                    Text(quality.message, color = quality.color, fontSize = 12.sp)
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Danger, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            val quality = if (password.isNotEmpty()) PasswordQualityResult.evaluate(password) else null
            val isValid = quality?.isAcceptable == true && password == confirmPassword

            Button(
                onClick = {
                    try {
                        wallet.createPassword(password)
                    } catch (e: Exception) {
                        error = e.message
                    }
                },
                enabled = isValid,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Accent,
                    disabledContainerColor = Accent.copy(alpha = 0.3f),
                ),
            ) {
                Text("Create Wallet", fontWeight = FontWeight.SemiBold)
            }

            Spacer(Modifier.height(12.dp))

            TextButton(onClick = { step = OnboardingStep.WELCOME }) {
                Text("Back", color = TextSecondary)
            }
        }

        Spacer(Modifier.weight(1f))
        Spacer(Modifier.height(32.dp))
    }
}
