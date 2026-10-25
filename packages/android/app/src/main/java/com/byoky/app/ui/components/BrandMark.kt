package com.byoky.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.byoky.app.ui.theme.Bone
import com.byoky.app.ui.theme.ChakraPetch
import com.byoky.app.ui.theme.Ink
import com.byoky.app.ui.theme.Phosphor
import com.byoky.app.ui.theme.Violet

/** The header lockup: logo tile plus the `BYOKY` wordmark. */
@Composable
fun BrandMark(modifier: Modifier = Modifier, tileSize: Dp = 24.dp) {
    val density = LocalDensity.current
    Row(
        modifier = modifier.clearAndSetSemantics {
            contentDescription = "Byoky"
            heading()
        },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LogoTile(size = tileSize)
        Spacer(Modifier.width(tileSize * 0.4f))
        Text(
            "BYOKY",
            color = Bone,
            style = TextStyle(
                fontFamily = ChakraPetch,
                fontWeight = FontWeight.Bold,
                fontSize = with(density) { (tileSize * 0.78f).toSp() },
                letterSpacing = 0.08.em,
            ),
        )
    }
}

/** Ink square with a violet inner stroke and a phosphor "b". The only rounded shape in the UI. */
@Composable
fun LogoTile(modifier: Modifier = Modifier, size: Dp = 24.dp) {
    val shape = RoundedCornerShape(size * 0.27f)
    val density = LocalDensity.current
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(Ink)
            .border(size * 0.065f, Violet, shape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "b",
            color = Phosphor,
            style = TextStyle(
                fontFamily = ChakraPetch,
                fontWeight = FontWeight.Bold,
                fontSize = with(density) { (size * 0.68f).toSp() },
            ),
        )
    }
}
