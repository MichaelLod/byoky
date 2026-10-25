package com.byoky.app.ui.theme

import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

// Retro-security palette (docs/brand/README.md). Dark only: there is no
// light theme. White is only for text on violet buttons.
val Void = Color(0xFF07060A)          // page and screen background
val Crypt = Color(0xFF100D16)         // cards, sheets, list rows
val Ash = Color(0xFF17121F)           // raised and pressed surfaces
val Ink = Color(0xFF0B0910)           // log blocks, the raven's body
val Seam = Color(0xFF2A2236)          // borders, dividers
val SeamStrong = Color(0xFF3B2D55)    // input and ghost-button borders, icon tiles
val Bone = Color(0xFFECE8F4)          // primary text
val Fog = Color(0xFFA79FB8)           // secondary text
val Dim = Color(0xFF857C95)           // muted text, mono labels
val Violet = Color(0xFF7C3AED)        // primary buttons, focus, active nav
val VioletHover = Color(0xFF8B5CF6)   // primary button pressed
val Phosphor = Color(0xFFA78BFA)      // accent text, links, prompts, cursor
val Lilac = Color(0xFFC4B5FD)         // highlights on violet-soft, the raven's eye
val VioletSoft = Color(0x2E7C3AED)    // badges, selected rows (18%)
val FocusRing = Color(0x407C3AED)     // ring around focused inputs (25%)
val Signal = Color(0xFF4ADE80)        // success, unlocked, 2xx
val Amber = Color(0xFFFBBF24)         // warnings
val Alarm = Color(0xFFF87171)         // errors, destructive actions, 4xx/5xx

private val ByokyColorScheme = darkColorScheme(
    primary = Violet,
    onPrimary = Color.White,
    primaryContainer = VioletSoft,
    onPrimaryContainer = Lilac,
    inversePrimary = Phosphor,
    secondary = Phosphor,
    onSecondary = Void,
    secondaryContainer = VioletSoft,
    onSecondaryContainer = Lilac,
    tertiary = Phosphor,
    onTertiary = Void,
    background = Void,
    onBackground = Bone,
    surface = Crypt,
    onSurface = Bone,
    surfaceVariant = Ash,
    onSurfaceVariant = Fog,
    surfaceTint = Color.Transparent,
    surfaceBright = Ash,
    surfaceDim = Void,
    surfaceContainerLowest = Void,
    surfaceContainerLow = Crypt,
    surfaceContainer = Crypt,
    surfaceContainerHigh = Crypt,
    surfaceContainerHighest = Ash,
    inverseSurface = Bone,
    inverseOnSurface = Void,
    error = Alarm,
    onError = Void,
    errorContainer = Alarm.copy(alpha = 0.15f),
    onErrorContainer = Alarm,
    outline = SeamStrong,
    outlineVariant = Seam,
    scrim = Color.Black.copy(alpha = 0.7f),
)

// Square corners everywhere. Only the logo tile is rounded, and it draws its own shape.
private val Square = RoundedCornerShape(0.dp)
private val ByokyShapes = Shapes(
    extraSmall = Square,
    small = Square,
    medium = Square,
    large = Square,
    extraLarge = Square,
)

/**
 * True when the system's "Remove animations" setting is on (animator duration
 * scale 0). The raven then holds still and the status-line cursor stops
 * blinking; state changes swap poses without animating.
 */
val LocalReducedMotion = staticCompositionLocalOf { false }

@Composable
fun ByokyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ByokyColorScheme,
        typography = ByokyTypography,
        shapes = ByokyShapes,
    ) {
        CompositionLocalProvider(
            LocalReducedMotion provides rememberReducedMotion(),
            LocalTextSelectionColors provides TextSelectionColors(
                handleColor = Violet,
                backgroundColor = Violet.copy(alpha = 0.4f),
            ),
            content = content,
        )
    }
}

/** Follows the animator duration scale, so toggling the setting applies without a restart. */
@Composable
private fun rememberReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    var reduced by remember { mutableStateOf(!ValueAnimator.areAnimatorsEnabled()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduced = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
            }
        }
        resolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer,
        )
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced
}
