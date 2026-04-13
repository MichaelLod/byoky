package com.byoky.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Extension palette
val Accent = Color(0xFF0EA5E9)
val AccentHover = Color(0xFF38BDF8)
val AccentSoft = Color(0x1F0EA5E9)
val BgMain = Color(0xFF141418)
val BgRaised = Color(0xFF1C1C22)
val BgCard = Color(0xFF24242C)
val BgHover = Color(0xFF2A2A34)
val TextPrimary = Color(0xFFF5F5F7)
val TextSecondary = Color(0xFF8E8E9A)
val TextMuted = Color(0xFF55555F)
val Danger = Color(0xFFF43F5E)
val Success = Color(0xFF34D399)
val Warning = Color(0xFFFB923C)
val Border = Color(0x0FFFFFFF)
val EyeCyan = Color(0xFF7DD3FC)

private val ByokyColorScheme = darkColorScheme(
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
