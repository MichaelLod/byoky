package com.byoky.app.ui.components

import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.byoky.app.R

@Composable
fun MascotView(modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(id = R.drawable.mascot),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier,
    )
}
