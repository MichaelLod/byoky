package com.byoky.app.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.byoky.app.R
import com.byoky.app.ui.theme.Lilac
import com.byoky.app.ui.theme.SeamStrong

/** Map a provider id to its brand-mark drawable, or null when unknown. */
@DrawableRes
fun providerDrawable(providerId: String): Int? = when (providerId) {
    "anthropic" -> R.drawable.provider_anthropic
    "openai" -> R.drawable.provider_openai
    "gemini" -> R.drawable.provider_gemini
    "mistral" -> R.drawable.provider_mistral
    "cohere" -> R.drawable.provider_cohere
    "xai" -> R.drawable.provider_xai
    "deepseek" -> R.drawable.provider_deepseek
    "perplexity" -> R.drawable.provider_perplexity
    "groq" -> R.drawable.provider_groq
    "together" -> R.drawable.provider_together
    "fireworks" -> R.drawable.provider_fireworks
    "openrouter" -> R.drawable.provider_openrouter
    "azure_openai" -> R.drawable.provider_azure_openai
    else -> null
}

/** Renders a provider's brand mark, falling back to a generic key glyph. */
@Composable
fun ProviderIcon(
    providerId: String,
    tint: Color,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
) {
    val drawable = providerDrawable(providerId)
    if (drawable != null) {
        Icon(
            painter = painterResource(drawable),
            contentDescription = null,
            tint = tint,
            modifier = modifier.size(size),
        )
    } else {
        Icon(
            imageVector = Icons.Default.Key,
            contentDescription = null,
            tint = tint,
            modifier = modifier.size(size),
        )
    }
}

/** A provider's mark in the square seam-strong tile used on cards and rows. */
@Composable
fun ProviderTile(
    providerId: String,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    iconSize: Dp = 20.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .border(1.dp, SeamStrong),
        contentAlignment = Alignment.Center,
    ) {
        ProviderIcon(providerId = providerId, tint = Lilac, size = iconSize)
    }
}
