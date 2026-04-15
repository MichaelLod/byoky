package com.byoky.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Brand palette (matches landing page)
val Accent = Color(0xFFFF4F00)
val AccentHover = Color(0xFFFF6A2A)
val AccentSoft = Color(0x1FFF4F00)
val BgMain = Color(0xFFF5F5F4)
val BgRaised = Color(0xFFF5F5F4)
val BgCard = Color(0xFFFFFFFF)
val BgHover = Color(0xFFE7E5E4)
val TextPrimary = Color(0xFF1C1917)
val TextSecondary = Color(0xFF57534E)
val TextMuted = Color(0xFFA8A29E)
val Danger = Color(0xFFDC2626)
val Success = Color(0xFF16A34A)
val Warning = Color(0xFFD97706)
val Border = Color(0xFFE7E5E4)

private val ByokyColorScheme = lightColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    primaryContainer = AccentSoft,
    onPrimaryContainer = Accent,
    secondary = AccentHover,
    background = BgMain,
    onBackground = TextPrimary,
    surface = BgCard,
    onSurface = TextPrimary,
    surfaceVariant = BgRaised,
    onSurfaceVariant = TextSecondary,
    error = Danger,
    onError = Color.White,
    outline = Border,
)

@Composable
fun ByokyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ByokyColorScheme,
        content = content,
    )
}
