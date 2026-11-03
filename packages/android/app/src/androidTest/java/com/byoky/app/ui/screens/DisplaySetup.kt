package com.byoky.app.ui.screens

import android.app.UiAutomation
import android.hardware.display.DisplayManager
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.view.Display
import android.view.Surface
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.AssumptionViolatedException
import org.junit.rules.ExternalResource

/**
 * Sets the system font scale and the rotation before the test and puts
 * both back after it.
 */
internal class DisplaySetup(private val fontScale: Float, private val landscape: Boolean) : ExternalResource() {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private var previousFontScale = "1.0"

    override fun before() {
        previousFontScale = shell("settings get system font_scale").trim().takeUnless { it.isEmpty() || it == "null" } ?: "1.0"
        shell("settings put system font_scale $fontScale")
        instrumentation.uiAutomation.setRotation(
            if (landscape) UiAutomation.ROTATION_FREEZE_90 else UiAutomation.ROTATION_FREEZE_0,
        )
        // The test activity starts after this, with the system's configuration then.
        val context = instrumentation.targetContext
        val display = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
        val rotation = if (landscape) Surface.ROTATION_90 else Surface.ROTATION_0
        val what = "font scale $fontScale, ${if (landscape) "landscape" else "portrait"}"
        val reached = waitUntil {
            Settings.System.getFloat(context.contentResolver, Settings.System.FONT_SCALE, 1f) == fontScale &&
                display.rotation == rotation
        }
        if (!reached) {
            // Some emulators (e.g. CI's headless one) ignore the rotation or
            // font-scale change; the layout can't be checked there, which is
            // a skip, not a layout failure.
            after()
            throw AssumptionViolatedException("this device never reached $what")
        }
    }

    override fun after() {
        shell("settings put system font_scale $previousFontScale")
        instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_UNFREEZE)
    }

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes().decodeToString() }
    }

    private fun waitUntil(condition: () -> Boolean): Boolean {
        repeat(300) {
            if (condition()) return true
            Thread.sleep(100)
        }
        return false
    }
}
