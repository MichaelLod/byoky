package com.byoky.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.data.PasswordStrength
import com.byoky.app.ui.theme.Alarm
import com.byoky.app.ui.theme.Amber
import com.byoky.app.ui.theme.Seam
import com.byoky.app.ui.theme.Signal

/**
 * Strength bar and label for a password being chosen, scored by
 * [PasswordStrength] (core's checkPasswordStrength, the rule the extension
 * uses). The master password and the export password show the same meter.
 */
@Composable
fun PasswordMeter(password: String, modifier: Modifier = Modifier) {
    val strength = remember(password) { PasswordStrength.check(password) }
    val color = when (strength.score) {
        0, 1 -> Alarm
        2 -> Amber
        else -> Signal
    }
    Column(modifier) {
        LinearProgressIndicator(
            progress = { (strength.score + 1) / 5f },
            modifier = Modifier.fillMaxWidth().height(4.dp),
            color = color,
            trackColor = Seam,
            strokeCap = StrokeCap.Butt,
            gapSize = 0.dp,
            drawStopIndicator = {},
        )
        Spacer(Modifier.height(4.dp))
        Text(
            strength.label + (strength.feedback.firstOrNull()?.let { " · $it" } ?: ""),
            color = color,
            fontSize = 12.sp,
        )
    }
}
