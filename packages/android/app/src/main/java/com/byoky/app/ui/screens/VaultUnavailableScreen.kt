package com.byoky.app.ui.screens

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.ui.components.BracketAction
import com.byoky.app.ui.components.BrandMark
import com.byoky.app.ui.components.CapsText
import com.byoky.app.ui.components.DialogButton
import com.byoky.app.ui.components.Muninn
import com.byoky.app.ui.components.PrimaryButton
import com.byoky.app.ui.components.RavenMood
import com.byoky.app.ui.components.RetroDialog
import com.byoky.app.ui.components.StatusLine
import com.byoky.app.ui.components.StatusPill
import com.byoky.app.ui.components.rememberRavenGaze
import com.byoky.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Shown instead of the wallet when the phone's Keystore refuses the key that
 * protects it, even after VaultPrefs retried. That can pass (a restart, an
 * OS fix), so nothing is deleted here: the user tries again, or chooses to
 * start a fresh wallet and restore from a `.byoky` backup, after confirming.
 *
 * [tryAgain] and [startFresh] block (Keystore and disk) and run off the main
 * thread; each returns true once the wallet is open, then [onOpened] runs.
 */
@Composable
fun VaultUnavailableScreen(
    tryAgain: () -> Boolean,
    startFresh: () -> Boolean,
    onOpened: () -> Unit,
) {
    var working by remember { mutableStateOf(false) }
    var stillFailing by remember { mutableStateOf(false) }
    var confirmStartFresh by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val gaze = rememberRavenGaze()

    fun run(action: () -> Boolean) {
        if (working) return
        working = true
        scope.launch {
            val opened = withContext(Dispatchers.IO) { action() }
            working = false
            if (opened) onOpened() else stillFailing = true
        }
    }

    LockScreenFrame(
        gaze = gaze,
        header = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandMark()
                Spacer(Modifier.weight(1f))
                StatusPill("Unavailable", color = Alarm)
            }
        },
    ) { compact ->
        Muninn(RavenMood.ALERT, modifier = Modifier.size(if (compact) 96.dp else 180.dp), gaze = gaze)

        StatusLine("Secure storage error", color = Alarm)

        Spacer(Modifier.height(8.dp))

        CapsText("Wallet won't open", style = DisplayStyle, color = Bone, textAlign = TextAlign.Center)

        Spacer(Modifier.height(8.dp))

        Text(
            "This phone's secure storage (Android Keystore) refused the key that protects your wallet. " +
                "That can pass: restart the phone, then try again. Your keys have not been deleted.",
            color = Fog,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp),
        )

        if (stillFailing && !working) {
            Spacer(Modifier.height(12.dp))
            Text(
                "Still can't open the wallet. Restart the phone and try again.",
                color = Alarm,
                style = MonoStyle,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(24.dp))

        PrimaryButton(
            if (working) "Opening…" else "Try again",
            onClick = { run(tryAgain) },
            enabled = !working,
            busy = working,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
        )

        Spacer(Modifier.height(4.dp))

        BracketAction(
            "Start a fresh wallet",
            onClick = { confirmStartFresh = true },
            color = Alarm,
            enabled = !working,
        )
    }

    if (confirmStartFresh) {
        RetroDialog(
            onDismissRequest = { confirmStartFresh = false },
            title = "Start a fresh wallet?",
            titleColor = Alarm,
            text = {
                Text(
                    "The keys on this phone will be lost. You can restore them from a .byoky backup with Import backup in Settings. " +
                        "If the problem may pass, restart the phone and try again first.",
                )
            },
            confirmButton = {
                DialogButton(
                    "Start fresh",
                    onClick = {
                        confirmStartFresh = false
                        run(startFresh)
                    },
                    color = Alarm,
                )
            },
            dismissButton = {
                DialogButton("Cancel", onClick = { confirmStartFresh = false }, color = Fog)
            },
        )
    }
}
