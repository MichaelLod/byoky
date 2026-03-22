package com.byoky.app.ui.screens

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.WalletStore
import com.byoky.app.ui.components.MascotView
import com.byoky.app.ui.theme.*

@Composable
fun UnlockScreen(wallet: WalletStore) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var shakeOffset by remember { mutableFloatStateOf(0f) }

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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BgMain)
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.weight(1f))

        MascotView(modifier = Modifier.size(120.dp))

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
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
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

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Danger, fontSize = 12.sp)
        }

        Spacer(Modifier.height(16.dp))

        Button(
            onClick = {
                if (!wallet.unlock(password)) {
                    error = "Wrong password"
                    password = ""
                    shakeOffset = 1f
                }
            },
            enabled = password.isNotEmpty(),
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

        Spacer(Modifier.weight(2f))
    }
}
