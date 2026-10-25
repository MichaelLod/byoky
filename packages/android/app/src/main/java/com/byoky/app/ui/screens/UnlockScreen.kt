package com.byoky.app.ui.screens

import android.os.SystemClock
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.UnlockResult
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.BracketAction
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.RetroTextField
import com.byoky.app.ui.components.StatusLine
import com.byoky.app.ui.components.StatusPill
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.rememberRavenGaze
import com.byoky.app.ui.components.scanlines
import com.byoky.app.ui.components.watchedBy
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun UnlockScreen(wallet: WalletStore) {
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var shakeOffset by remember { mutableFloatStateOf(0f) }
    val lockoutUntil by wallet.lockoutUntil.collectAsState()
    var lockoutRemaining by remember { mutableIntStateOf(0) }
    var showResetDialog by remember { mutableStateOf(false) }
    var unlocking by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val shakeAnim = remember { Animatable(0f) }

    LaunchedEffect(shakeOffset) {
        if (shakeOffset != 0f) {
            shakeAnim.animateTo(
                0f,
                animationSpec = spring(dampingRatio = 0.3f, stiffness = 800f),
                initialVelocity = 40f,
            )
            shakeOffset = 0f
        }
    }

    // Lockout countdown timer, on the monotonic clock the lockout uses.
    LaunchedEffect(lockoutUntil) {
        val endTime = lockoutUntil
        if (endTime != null && endTime > SystemClock.elapsedRealtime()) {
            while (true) {
                val remaining = ((endTime - SystemClock.elapsedRealtime() + 999) / 1000).toInt()
                if (remaining <= 0) {
                    lockoutRemaining = 0
                    break
                }
                lockoutRemaining = remaining
                delay(1000)
            }
        } else {
            lockoutRemaining = 0
        }
    }

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
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark()
            Spacer(Modifier.weight(1f))
            StatusPill("Locked", color = Dim)
        }

        Spacer(Modifier.weight(1f))

        // Muninn sleeps while the wallet is locked and wakes up while the
        // password is checked; the wallet screen finishes with a nod.
        Muninn(
            if (unlocking) RavenMood.WATCHING else RavenMood.ASLEEP,
            modifier = Modifier.size(210.dp),
            gaze = gaze,
        )

        StatusLine(if (unlocking) "Unlocking" else "Wallet locked")

        Spacer(Modifier.height(8.dp))

        CapsText(
            if (unlocking) "Muninn is waking" else "Muninn is asleep",
            style = DisplayStyle,
            color = Bone,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(8.dp))

        Text(
            "Your keys are encrypted on this phone. Enter your master password to wake Muninn.",
            color = Fog,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )

        Spacer(Modifier.height(28.dp))

        RetroTextField(
            value = password,
            onValueChange = { password = it; error = null },
            label = "Master password",
            mono = true,
            leadingIcon = {
                Icon(Icons.Filled.Lock, contentDescription = null, modifier = Modifier.size(18.dp))
            },
            trailingIcon = {
                IconButton(
                    onClick = { showPassword = !showPassword },
                    enabled = lockoutRemaining <= 0,
                ) {
                    Icon(
                        if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (showPassword) "Hide password" else "Show password",
                        modifier = Modifier.size(18.dp),
                    )
                }
            },
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            enabled = lockoutRemaining <= 0 && !unlocking,
            isError = error != null || lockoutRemaining > 0,
            modifier = Modifier
                .fillMaxWidth()
                .offset { IntOffset(shakeAnim.value.dp.roundToPx(), 0) },
        )

        if (lockoutRemaining > 0) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Too many attempts. Try again in ${lockoutRemaining}s",
                color = Alarm,
                style = MonoStyle,
            )
        } else {
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Alarm, style = MonoStyle)
            }
        }

        Spacer(Modifier.height(14.dp))

        PrimaryButton(
            if (unlocking) "Unlocking…" else "Unlock",
            onClick = {
                if (unlocking) return@PrimaryButton
                unlocking = true
                scope.launch {
                    // Key derivation runs on Dispatchers.Default inside unlock().
                    when (val result = wallet.unlock(password)) {
                        is UnlockResult.Success -> { /* navigates automatically */ }
                        is UnlockResult.WrongPassword -> {
                            error = "Wrong password"
                            password = ""
                            shakeOffset = 1f
                        }
                        is UnlockResult.LockedOut -> {
                            error = "Too many attempts. Try again in ${result.secondsRemaining}s"
                            password = ""
                        }
                    }
                    unlocking = false
                }
            },
            enabled = password.isNotEmpty() && lockoutRemaining <= 0 && !unlocking,
            busy = unlocking,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        )

        Spacer(Modifier.height(4.dp))

        BracketAction("Forgot password?", onClick = { showResetDialog = true }, color = Dim)

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

    if (showResetDialog) {
        RetroDialog(
            onDismissRequest = { showResetDialog = false },
            title = "Reset Wallet?",
            titleColor = Alarm,
            text = {
                Text("This will permanently delete all API keys, sessions, and settings. This cannot be undone.")
            },
            confirmButton = {
                DialogButton(
                    "Reset",
                    onClick = {
                        showResetDialog = false
                        wallet.resetWallet()
                    },
                    color = Alarm,
                )
            },
            dismissButton = {
                DialogButton("Cancel", onClick = { showResetDialog = false }, color = Fog)
            },
        )
    }
}
