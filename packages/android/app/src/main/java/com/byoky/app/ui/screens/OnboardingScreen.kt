package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.BracketAction
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.StatusLine
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.rememberRavenGaze
import com.byoky.app.ui.components.scanlines
import com.byoky.app.ui.components.watchedBy
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.launch

internal data class PasswordQualityResult(
    val icon: ImageVector,
    val message: String,
    val color: Color,
    val isAcceptable: Boolean,
) {
    companion object {
        fun evaluate(password: String): PasswordQualityResult {
            if (password.length < 12) return PasswordQualityResult(Icons.Default.Warning, "Minimum 12 characters", Amber, false)
            if (password.toSet().size < 4) return PasswordQualityResult(Icons.Default.Warning, "Too many repeated characters", Amber, false)
            val hasLower = password.any { it.isLowerCase() }
            val hasUpper = password.any { it.isUpperCase() }
            val hasDigit = password.any { it.isDigit() }
            val hasSymbol = password.any { !it.isLetterOrDigit() }
            val classCount = listOf(hasLower, hasUpper, hasDigit, hasSymbol).count { it }
            if (classCount < 2) return PasswordQualityResult(Icons.Default.Warning, "Use a mix of letters, numbers, or symbols", Amber, false)
            if (classCount >= 3 && password.length >= 16) return PasswordQualityResult(Icons.Default.Shield, "Strong password", Signal, true)
            return PasswordQualityResult(Icons.Default.CheckCircle, "Fair — consider adding more variety", Phosphor, true)
        }
    }
}

private enum class OnboardingStep { WELCOME, PASSWORD }

@Composable
fun OnboardingScreen(wallet: WalletStore) {
    var step by remember { mutableStateOf(OnboardingStep.WELCOME) }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val gaze = rememberRavenGaze()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Void)
            .dotGrid()
            .watchedBy(gaze)
            .scanlines()
            .systemBarsPadding()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BrandMark(modifier = Modifier.align(Alignment.Start).padding(top = 16.dp))

        Spacer(Modifier.weight(1f))

        if (step == OnboardingStep.WELCOME) {
            Muninn(RavenMood.WATCHING, modifier = Modifier.size(220.dp), gaze = gaze)

            StatusLine("New wallet")

            Spacer(Modifier.height(10.dp))

            CapsText("Byoky Wallet", style = DisplayStyle, color = Bone, textAlign = TextAlign.Center)

            Spacer(Modifier.height(12.dp))

            Text(
                "Your encrypted wallet for AI API keys. Keys stay on this device; apps you open in the wallet use them without ever seeing them.",
                color = Fog,
                fontSize = 15.sp,
                lineHeight = 22.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp),
            )

            Spacer(Modifier.height(32.dp))

            PrimaryButton(
                "Get Started",
                onClick = { step = OnboardingStep.PASSWORD },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            )

        } else {
            // Password step
            Muninn(RavenMood.WATCHING, modifier = Modifier.size(120.dp), gaze = gaze)

            StatusLine("New wallet")

            Spacer(Modifier.height(10.dp))

            CapsText(
                "Set Master Password",
                style = DisplayStyle.copy(fontSize = 26.sp, lineHeight = 30.sp),
                color = Bone,
                textAlign = TextAlign.Center,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                "This password encrypts all your API keys. It's never stored — only a hash is kept to verify unlock.",
                color = Fog,
                fontSize = 14.sp,
                lineHeight = 20.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp),
            )

            Spacer(Modifier.height(24.dp))

            RetroTextField(
                value = password,
                onValueChange = { password = it },
                label = "Master password",
                mono = true,
                secret = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(Modifier.height(14.dp))

            RetroTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = "Confirm password",
                mono = true,
                secret = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )

            if (password.isNotEmpty()) {
                val quality = PasswordQualityResult.evaluate(password)
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(quality.icon, null, tint = quality.color, modifier = Modifier.size(14.dp))
                    Text(quality.message, color = quality.color, style = MonoStyle)
                }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Alarm, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            val quality = if (password.isNotEmpty()) PasswordQualityResult.evaluate(password) else null
            val isValid = quality?.isAcceptable == true && password == confirmPassword

            PrimaryButton(
                if (creating) "Creating wallet…" else "Create Wallet",
                onClick = {
                    if (creating) return@PrimaryButton
                    creating = true
                    error = null
                    scope.launch {
                        // Hashing runs on Dispatchers.Default inside createPassword().
                        try {
                            wallet.createPassword(password)
                        } catch (e: Exception) {
                            error = e.message
                        }
                        creating = false
                    }
                },
                enabled = isValid && !creating,
                busy = creating,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            )

            Spacer(Modifier.height(8.dp))

            BracketAction("Back", onClick = { step = OnboardingStep.WELCOME }, color = Fog)
        }

        Spacer(Modifier.weight(1f))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("Keys stay on this device", style = MonoStyle.copy(fontSize = 11.sp), color = Dim)
            Text("AES-256-GCM", style = MonoStyle.copy(fontSize = 11.sp), color = Dim)
        }
    }
}
