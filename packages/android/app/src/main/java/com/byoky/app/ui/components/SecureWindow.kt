package com.byoky.app.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import java.util.WeakHashMap

/**
 * Keeps the activity's window out of screenshots, screen recordings and the
 * recents thumbnail (FLAG_SECURE) while [enabled] and composed. Only for a
 * screen while it shows a secret in clear text, such as a revealed
 * password: users and the store screenshots capture the rest of the app.
 * Dialogs and sheets have windows of their own and use
 * [SecretDialogProperties] (or securePolicy) instead.
 */
@Composable
fun SecureWindow(enabled: Boolean) {
    val window = LocalContext.current.findActivity()?.window
    DisposableEffect(window, enabled) {
        if (window == null || !enabled) return@DisposableEffect onDispose {}
        SecureFlag.acquire(window)
        onDispose { SecureFlag.release(window) }
    }
}

/** For dialogs where a password is typed and can be shown: kept out of screenshots and recents. */
val SecretDialogProperties = DialogProperties(securePolicy = SecureFlagPolicy.SecureOn)

/** Holders per window, so one screen dropping the flag doesn't clear it for another. */
private object SecureFlag {
    private val holders = WeakHashMap<Window, Int>()

    fun acquire(window: Window) {
        val count = holders[window] ?: 0
        if (count == 0) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        holders[window] = count + 1
    }

    fun release(window: Window) {
        val count = (holders[window] ?: return) - 1
        if (count > 0) {
            holders[window] = count
        } else {
            holders.remove(window)
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
