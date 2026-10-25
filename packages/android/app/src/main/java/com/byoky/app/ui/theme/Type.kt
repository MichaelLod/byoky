package com.byoky.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.byoky.app.R

// Bundled SIL OFL fonts (licenses in assets/licenses). Body text uses the
// system font, which stands in for IBM Plex Sans on Android.
val ChakraPetch = FontFamily(
    Font(R.font.chakra_petch_semibold, FontWeight.SemiBold),
    Font(R.font.chakra_petch_bold, FontWeight.Bold),
)

val PlexMono = FontFamily(
    Font(R.font.ibm_plex_mono_regular, FontWeight.Normal),
    Font(R.font.ibm_plex_mono_medium, FontWeight.Medium),
)

/** Screen titles: Chakra Petch 700, uppercase (pass uppercase text). */
val DisplayStyle = TextStyle(
    fontFamily = ChakraPetch,
    fontWeight = FontWeight.Bold,
    fontSize = 30.sp,
    lineHeight = 34.sp,
    letterSpacing = 0.03.em,
)

/** Card and section headings. */
val HeadingStyle = TextStyle(
    fontFamily = ChakraPetch,
    fontWeight = FontWeight.Bold,
    fontSize = 17.sp,
    lineHeight = 22.sp,
    letterSpacing = 0.05.em,
)

/** Button labels: Chakra Petch 600, uppercase, wide-tracked. */
val ButtonStyle = TextStyle(
    fontFamily = ChakraPetch,
    fontWeight = FontWeight.SemiBold,
    fontSize = 15.sp,
    lineHeight = 20.sp,
    letterSpacing = 0.1.em,
)

/** Section labels: mono, uppercase, wide-tracked. */
val MonoLabelStyle = TextStyle(
    fontFamily = PlexMono,
    fontWeight = FontWeight.Medium,
    fontSize = 11.sp,
    lineHeight = 16.sp,
    letterSpacing = 0.14.em,
)

/** Machine text: masked keys, origins, models, token counts, timestamps. */
val MonoStyle = TextStyle(
    fontFamily = PlexMono,
    fontWeight = FontWeight.Normal,
    fontSize = 12.sp,
    lineHeight = 17.sp,
)

private val Default = Typography()

val ByokyTypography = Typography(
    displayLarge = Default.displayLarge.copy(fontFamily = ChakraPetch, fontWeight = FontWeight.Bold),
    displayMedium = Default.displayMedium.copy(fontFamily = ChakraPetch, fontWeight = FontWeight.Bold),
    displaySmall = Default.displaySmall.copy(fontFamily = ChakraPetch, fontWeight = FontWeight.Bold),
    headlineLarge = Default.headlineLarge.copy(fontFamily = ChakraPetch, fontWeight = FontWeight.Bold, letterSpacing = 0.02.em),
    headlineMedium = Default.headlineMedium.copy(fontFamily = ChakraPetch, fontWeight = FontWeight.Bold, letterSpacing = 0.02.em),
    // Dialog titles.
    headlineSmall = Default.headlineSmall.copy(
        fontFamily = ChakraPetch,
        fontWeight = FontWeight.Bold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = 0.04.em,
    ),
    // Top app bar titles.
    titleLarge = Default.titleLarge.copy(
        fontFamily = ChakraPetch,
        fontWeight = FontWeight.Bold,
        fontSize = 22.sp,
        letterSpacing = 0.06.em,
    ),
)
