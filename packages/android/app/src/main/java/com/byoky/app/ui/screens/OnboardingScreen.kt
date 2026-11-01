package com.byoky.app.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.PasswordStrength
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.BracketAction
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PasswordMeter
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.StatusLine
import com.byoky.app.ui.components.rememberRavenGaze
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * Create Wallet is enabled once the master password passes the rule the
 * extension's setup and the export dialog apply (core checkPasswordStrength:
 * 12+ characters and a score of 2 or more) and the confirmation matches.
 */
internal fun canCreateWallet(password: String, confirmPassword: String): Boolean =
    PasswordStrength.isAcceptableForExport(password) && password == confirmPassword

private enum class OnboardingStep { WELCOME, PASSWORD }

@Composable
fun OnboardingScreen(wallet: WalletStore) {
    // The step survives the activity being recreated; the passwords are
    // deliberately never put in saved state.
    var step by rememberSaveable { mutableStateOf(OnboardingStep.WELCOME) }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val gaze = rememberRavenGaze()

    fun createWallet() {
        if (creating || !canCreateWallet(password, confirmPassword)) return
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
    }

    // System back on the password step returns to the welcome step, like [ Back ].
    BackHandler(enabled = step == OnboardingStep.PASSWORD && !creating) {
        step = OnboardingStep.WELCOME
        error = null
    }

    LockScreenFrame(
        gaze = gaze,
        header = { BrandMark(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) },
    ) { compact ->
        if (step == OnboardingStep.WELCOME) {
            Muninn(RavenMood.WATCHING, modifier = Modifier.size(if (compact) 96.dp else 220.dp), gaze = gaze)

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
            Muninn(RavenMood.WATCHING, modifier = Modifier.size(if (compact) 72.dp else 120.dp), gaze = gaze)

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
                // Next moves on to the confirm field.
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )

            // The meter rates the password above it; the confirm field says
            // when the two differ, so a disabled Create Wallet always has a reason.
            if (password.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                PasswordMeter(password, modifier = Modifier.fillMaxWidth())
            }

            Spacer(Modifier.height(14.dp))

            val mismatch = confirmPassword.isNotEmpty() && confirmPassword != password
            RetroTextField(
                value = confirmPassword,
                onValueChange = { confirmPassword = it },
                label = "Confirm password",
                mono = true,
                secret = true,
                isError = mismatch,
                // Part of the field, so it stays above the keyboard with it.
                supportingText = if (mismatch) "Passwords do not match" else null,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { createWallet() }),
                modifier = Modifier.fillMaxWidth(),
            )

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Alarm, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            PrimaryButton(
                if (creating) "Creating wallet…" else "Create Wallet",
                onClick = { createWallet() },
                enabled = canCreateWallet(password, confirmPassword) && !creating,
                busy = creating,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
            )

            Spacer(Modifier.height(8.dp))

            BracketAction("Back", onClick = { step = OnboardingStep.WELCOME; error = null }, color = Fog)
        }
    }
}
