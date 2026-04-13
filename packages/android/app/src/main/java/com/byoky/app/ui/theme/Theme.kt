package com.byoky.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Extension palette — light theme, orange brand
val Accent = Color(0xFFFF4F00)
val AccentHover = Color(0xFFFF6B2B)
val AccentSoft = Color(0x14FF4F00)
val BgMain = Color(0xFFFFFFFF)
val BgRaised = Color(0xFFF8F9FA)
val BgCard = Color(0xFFFFFFFF)
val BgHover = Color(0xFFF1F3F5)
val TextPrimary = Color(0xFF1A1A2E)
val TextSecondary = Color(0xFF64748B)
val TextMuted = Color(0xFF94A3B8)
val Danger = Color(0xFFF43F5E)
val Success = Color(0xFF22C55E)
val Warning = Color(0xFFFB923C)
val Border = Color(0xFFE2E8F0)

private val ByokyColorScheme = lightColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    primaryContainer = AccentSoft,
    secondary = AccentHover,
    background = BgMain,
    surface = BgRaised,
    surfaceVariant = BgCard,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
    onSurfaceVariant = TextSecondary,
    error = Danger,
    outline = Border,
)

@Composable
fun ByokyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ByokyColorScheme,
        content = content,
    )
}
