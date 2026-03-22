package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.MascotView
import com.byoky.app.ui.theme.*

@Composable
fun OnboardingScreen(wallet: WalletStore) {
    var step by remember { mutableIntStateOf(0) }
    var password by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgMain)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        if (step == 0) {
            // Welcome step
            MascotView(
                modifier = Modifier.size(140.dp),
            )

            Spacer(Modifier.height(24.dp))

            Text(
                "Byoky Wallet",
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
            )

            Spacer(Modifier.height(12.dp))

            Text(
                "Your AI API keys, encrypted and always with you. Apps connect through the wallet — keys never leave your device.",
                color = TextSecondary,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            Spacer(Modifier.height(24.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FeatureRow(Icons.Default.Shield, "AES-256-GCM encryption with Keystore")
                FeatureRow(Icons.Default.VisibilityOff, "Keys never exposed to apps")
                FeatureRow(Icons.Default.CellTower, "Bridge proxy for OAuth and remote tools")
                FeatureRow(Icons.Default.Share, "Relay for remote OpenClaw")
            }

            Spacer(Modifier.height(32.dp))

            Button(
                onClick = { step = 1 },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) {
                Text("Get Started", fontWeight = FontWeight.SemiBold)
            }
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

            if (password.isNotEmpty() && password.length < 12) {
                Spacer(Modifier.height(8.dp))
                Text("Minimum 12 characters", color = Danger, fontSize = 12.sp)
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = Danger, fontSize = 12.sp)
            }

            Spacer(Modifier.height(24.dp))

            val isValid = password.length >= 12 && password == confirmPassword

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

            TextButton(onClick = { step = 0 }) {
                Text("Back", color = TextSecondary)
            }
        }

        Spacer(Modifier.weight(1f))

        // Step indicator
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (step == 0) Accent else TextMuted),
            )
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (step == 1) Accent else TextMuted),
            )
        }

        Spacer(Modifier.height(32.dp))
    }
}

@Composable
private fun FeatureRow(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Accent, modifier = Modifier.size(20.dp))
        Text(text, color = TextSecondary, fontSize = 14.sp)
    }
}
