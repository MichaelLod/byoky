package com.byoky.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.byoky.app.R

/**
 * Renders the Byoky logo from the launcher icon.
 */
@Composable
fun MascotView(modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(R.mipmap.ic_launcher),
        contentDescription = "Byoky",
        modifier = modifier,
        contentScale = ContentScale.Fit,
    )
}
