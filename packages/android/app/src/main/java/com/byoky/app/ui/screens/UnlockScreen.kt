package com.byoky.app.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.UnlockResult
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.delay

@Composable
fun UnlockScreen(wallet: WalletStore) {
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var shakeOffset by remember { mutableFloatStateOf(0f) }
    val lockoutEndTime by wallet.lockoutEndTime.collectAsState()
    var lockoutRemaining by remember { mutableIntStateOf(0) }
    var showResetDialog by remember { mutableStateOf(false) }

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

    // Lockout countdown timer
    LaunchedEffect(lockoutEndTime) {
        val endTime = lockoutEndTime
        if (endTime != null && endTime > System.currentTimeMillis()) {
            while (true) {
                val remaining = ((endTime - System.currentTimeMillis()) / 1000).toInt()
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgMain)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        BrandMark(modifier = Modifier.size(120.dp))

        Spacer(Modifier.height(24.dp))

        Text(
            "Byoky Wallet",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
        )

        Spacer(Modifier.height(8.dp))

        Text(
            "Enter your master password to unlock",
            color = TextSecondary,
        )

        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it; error = null },
            label = { Text("Master password") },
            leadingIcon = {
                Icon(Icons.Filled.Lock, contentDescription = null, tint = TextMuted, modifier = Modifier.size(18.dp))
            },
            trailingIcon = {
                IconButton(
                    onClick = { showPassword = !showPassword },
                    enabled = lockoutRemaining <= 0,
                ) {
                    Icon(
                        if (showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility,
                        contentDescription = if (showPassword) "Hide password" else "Show password",
                        tint = TextMuted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            },
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            singleLine = true,
            enabled = lockoutRemaining <= 0,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .offset(x = shakeAnim.value.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                unfocusedBorderColor = Border,
                focusedContainerColor = BgRaised,
                unfocusedContainerColor = BgRaised,
            ),
            shape = RoundedCornerShape(12.dp),
        )

        if (lockoutRemaining > 0) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Too many attempts. Try again in ${lockoutRemaining}s",
                color = Danger,
                fontSize = 12.sp,
            )
        } else {
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Danger, fontSize = 12.sp)
            }
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
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
            },
            enabled = password.isNotEmpty() && lockoutRemaining <= 0,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .height(52.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Accent,
                disabledContainerColor = Accent.copy(alpha = 0.3f),
            ),
        ) {
            Text("Unlock", fontWeight = FontWeight.SemiBold)
        }

        Spacer(Modifier.weight(1f))

        TextButton(onClick = { showResetDialog = true }) {
            Text("Forgot password?", color = TextMuted)
        }

        Spacer(Modifier.weight(1f))
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            title = { Text("Reset Wallet?", color = TextPrimary) },
            text = {
                Text(
                    "This will permanently delete all API keys, sessions, and settings. This cannot be undone.",
                    color = TextSecondary,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showResetDialog = false
                    wallet.resetWallet()
                }) {
                    Text("Reset", color = Danger)
                }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) {
                    Text("Cancel", color = TextSecondary)
                }
            },
            containerColor = BgCard,
        )
    }
}
