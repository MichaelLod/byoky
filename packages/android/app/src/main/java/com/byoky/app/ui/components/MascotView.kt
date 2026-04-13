package com.byoky.app.ui.components

import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Renders the Byoky owl mascot from the bundled SVG using a lightweight WebView.
 */
@Composable
fun MascotView(modifier: Modifier = Modifier) {
    val context = LocalContext.current

    AndroidView(
        modifier = modifier,
        factory = {
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.apply {
                    javaScriptEnabled = false
                    loadWithOverviewMode = true
                    useWideViewPort = true
                }

                val svgContent = try {
                    context.assets.open("mascot.svg").bufferedReader().readText()
                } catch (e: Exception) {
                    // Fallback — try from raw resources
                    ""
                }

                if (svgContent.isNotEmpty()) {
                    val html = """
                        <!DOCTYPE html>
                        <html><head>
                        <meta name="viewport" content="width=device-width,initial-scale=1">
                        <style>*{margin:0;padding:0}body{background:transparent;display:flex;align-items:center;justify-content:center;height:100vh}svg{width:100%;height:100%}</style>
                        </head><body>$svgContent</body></html>
                    """.trimIndent()
                    loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                }
            }
        },
    )
}
