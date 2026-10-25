package com.byoky.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.border
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import com.byoky.app.R
import com.byoky.app.ui.theme.Bone
import com.byoky.app.ui.theme.ChakraPetch
import com.byoky.app.ui.theme.SeamStrong

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

/**
 * Muninn's head, the app icon (docs/brand/app-icon-small.svg, rendered to
 * res/drawable-nodpi/logo_tile.png). The only rounded shape in the UI.
 */
@Composable
fun LogoTile(modifier: Modifier = Modifier, size: Dp = 24.dp) {
    val shape = RoundedCornerShape(size * 0.225f)
    Image(
        painter = painterResource(R.drawable.logo_tile),
        contentDescription = null,
        modifier = modifier
            .size(size)
            .clip(shape)
            // Lifts the black tile off a black header.
            .border(1.dp, SeamStrong, shape),
    )
}
