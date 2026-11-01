package com.byoky.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.byoky.app.ui.components.RavenGaze
import com.byoky.app.ui.components.dotGrid
import com.byoky.app.ui.components.scanlines
import com.byoky.app.ui.components.watchedBy
import com.byoky.app.ui.theme.Dim
import com.byoky.app.ui.theme.MonoStyle
import com.byoky.app.ui.theme.Void

/**
 * Frame of the onboarding and unlock screens: [header] on top, the centred
 * [content], the security footer at the bottom. It scrolls and makes room
 * for the keyboard, so the fields and the main button stay reachable in
 * landscape and with the keyboard up. [content] is told when the height is
 * tight (a phone in landscape) so it can draw Muninn smaller.
 */
@Composable
internal fun LockScreenFrame(
    gaze: RavenGaze,
    header: @Composable () -> Unit,
    content: @Composable ColumnScope.(compact: Boolean) -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .background(Void)
            .dotGrid()
            .watchedBy(gaze)
            .scanlines()
            .systemBarsPadding(),
    ) {
        // Measured without the keyboard, so Muninn doesn't shrink while typing.
        val compact = maxHeight < 500.dp
        Column(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            header()
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = if (compact) 12.dp else 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                content(compact)
            }
            LockScreenFooter()
        }
    }
}

@Composable
private fun LockScreenFooter() {
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
