package com.byoky.app

import android.content.Intent
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * UI Automator tests that pair with `e2e/tests/interactive-cross-device.spec.ts`
 * for the Android↔desktop-extension cross-device gift flow.
 *
 * Mirrors `packages/ios/ByokyUITests/ByokyInteractiveCrossDeviceTests.swift`.
 *
 * The orchestrator (`scripts/run-interactive-cross-device-android.sh`) passes
 * a config-file path via instrumentation args and watches `adb logcat -s
 * BYOKY_TEST` for handoff events. The test launches MainActivity with the
 * config as an Intent extra (TestSupport.autoSetupIfNeeded reads it).
 *
 * Bridge to the host:
 *   - host → device:   `adb push <config>.json /data/local/tmp/byoky-test-config.json`
 *                       then `am instrument -e configFile <path>`
 *   - device → host:   `Log.i("BYOKY_TEST", "<KEY>=<value>")` watched by
 *                       `adb logcat -s BYOKY_TEST:I` on the orchestrator side
 *   - host → device sentinels:  `adb push` to /data/local/tmp/<sentinel>
 */
@RunWith(AndroidJUnit4::class)
class AndroidInteractiveCrossDeviceTest {

    private val tag = "BYOKY_TEST"
    private val packageName = "com.byoky.app"
    private lateinit var device: UiDevice

    @Before
    fun setUp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.pressHome()
    }

    private fun loadConfigJson(): String {
        val args = InstrumentationRegistry.getArguments()
        val path = args.getString("configFile") ?: "/data/local/tmp/byoky-test-config.json"
        val file = File(path)
        require(file.exists()) { "Config file missing at $path — run via scripts/run-interactive-cross-device-android.sh" }
        return file.readText()
    }

    private fun launchAppWithConfig(configJson: String) {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = ctx.packageManager.getLaunchIntentForPackage(packageName)!!
        // Required when starting from a non-Activity context. CLEAR_TASK so
        // a fresh MainActivity is created with our extras (otherwise
        // SINGLE_TOP would route to onNewIntent which we don't override).
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        intent.putExtra("byoky_test_config_json", configJson)
        Log.i(tag, "launchApp extras_size=${intent.extras?.size() ?: 0} configLen=${configJson.length}")
        ctx.startActivity(intent)
        device.wait(Until.hasObject(By.pkg(packageName).depth(0)), 15_000)
    }

    private fun click(text: String, timeoutMs: Long = 10_000) {
        val sel = By.text(text)
        check(device.wait(Until.hasObject(sel), timeoutMs)) { "Element with text '$text' never appeared" }
        device.findObject(sel).click()
    }

    private fun clickFirst(text: String, timeoutMs: Long = 10_000) {
        val sel = By.text(text)
        check(device.wait(Until.hasObject(sel), timeoutMs)) { "Element with text '$text' never appeared" }
        device.findObjects(sel).first().click()
    }

    // ── Stage A: Android sends gift, desktop redeems + proxies ────────

    @Test
    fun testAndroidSendsGift_Interactive() {
        val config = loadConfigJson()
        launchAppWithConfig(config)

        // Auto-setup imports the gemini key. Each credential triggers a
        // PBKDF2 derive (600k iterations — see CryptoService.kt:16) which
        // is brutal on an emulator (~15-30s per credential). Allow up to
        // 90s for the credential row to appear.
        check(device.wait(Until.hasObject(By.text("Google Gemini")), 90_000)) {
            "Auto-setup didn't import gemini credential — check logcat BYOKY_TEST"
        }

        // Navigate to Gifts tab via bottom nav.
        click("Gifts")
        Thread.sleep(800)

        // Tap "Create Gift" entry. Both the empty-state link and the
        // bottom action share that text — clickFirst is fine, either works.
        clickFirst("Create Gift")

        // Use the smallest preset chip (10K) instead of fighting Compose's
        // custom-amount TextField focus model. 10K is well above what a
        // hello-world request consumes; budget concerns don't matter for
        // a single-shot relay test.
        val preset = device.wait(Until.findObject(By.text("10K")), 5_000)
        check(preset != null) { "10K token preset chip not found" }
        preset.click()
        Thread.sleep(300)

        // The form is taller than the screen — submit Button sits below
        // the visible area until we scroll. Compose Material3 Button is
        // unreachable through UI Automator's a11y tree (descendants are
        // merged, parent's text is null), so after scrolling we tap raw
        // coordinates near the bottom of the form via `input tap`.
        Thread.sleep(500)
        val w = device.displayWidth
        val h = device.displayHeight
        // Swipe up on the form to reveal the submit button. Start ~70% down,
        // end ~20% down — moves content up by half the screen.
        device.executeShellCommand("input swipe ${w / 2} ${(h * 0.7).toInt()} ${w / 2} ${(h * 0.2).toInt()} 400")
        Thread.sleep(600)
        runCatching {
            device.executeShellCommand("screencap -p /sdcard/byoky-pre-submit.png")
            Log.i(tag, "PRE_SUBMIT_SCREENSHOT=/sdcard/byoky-pre-submit.png")
        }
        // After scroll, submit button center is ~85% of screen (2040 on a
        // 2400px screen), well above the gesture nav area at the bottom.
        val tx = w / 2
        val ty = (h * 0.86).toInt()
        Log.i(tag, "submit_input_tap screen=${w}x$h target=($tx,$ty)")
        device.executeShellCommand("input tap $tx $ty")

        // Success screen shows the "Gift Created!" header.
        if (!device.wait(Until.hasObject(By.text("Gift Created!")), 30_000)) {
            runCatching {
                device.executeShellCommand("screencap -p /sdcard/byoky-form-fail.png")
                device.executeShellCommand("uiautomator dump /sdcard/byoky-form-fail.xml")
                Log.i(tag, "FORM_SCREENSHOT=/sdcard/byoky-form-fail.png")
                Log.i(tag, "FORM_DUMP=/sdcard/byoky-form-fail.xml")
            }
            error("Gift Created! header never appeared — submit may have failed")
        }
        // Pull the URL from the EditText. There's only one read-only
        // EditText on this screen — the gift link field.
        val urlField = device.wait(
            Until.findObject(By.clazz("android.widget.EditText")),
            5_000,
        )
        check(urlField != null) { "Gift link EditText not found on success screen" }
        val link = urlField.text
        check(link != null && link.startsWith("https://byoky.com/gift")) {
            "Gift link looks wrong: $link"
        }
        Log.i(tag, "GIFT_LINK=$link")

        click("Done")

        // Block until orchestrator drops the done sentinel. The app stays
        // foregrounded so GiftRelayHost keeps its sender socket open and
        // serves the desktop's relay request.
        val doneFile = File("/data/local/tmp/byoky-android-done.sig")
        val deadline = System.currentTimeMillis() + 300_000
        while (!doneFile.exists()) {
            if (System.currentTimeMillis() > deadline) error("Desktop never signalled done within 5min")
            Thread.sleep(500)
        }
        runCatching { doneFile.delete() }
        Log.i(tag, "SENDER_EXIT=ok")
    }

    // ── Stage B: desktop sends gift, Android redeems + auto-fires ─────

    @Test
    fun testAndroidRedeemsGift_Interactive() {
        val config = loadConfigJson()
        launchAppWithConfig(config)

        // TestSupport (running off-Main) handles redeemGift + fireAfter-
        // Setup directly — bypasses the Compose UI typing layer because
        // `input text` mangles the ~800-char base64 link. We just need to
        // keep the app foregrounded so the GiftRelayProxy WebSocket can
        // run to completion. Wait on the orchestrator's done sentinel.
        Log.i(tag, "RECEIVER_WAITING_FOR_PROXY_RESULT")
        val resultDeadline = System.currentTimeMillis() + 180_000
        val resultMarker = File("/data/local/tmp/byoky-android-proxy-done.sig")
        while (!resultMarker.exists() && System.currentTimeMillis() < resultDeadline) {
            Thread.sleep(500)
        }
        if (!resultMarker.exists()) {
            Log.w(tag, "RECEIVER_TIMEOUT=true")
        }
        runCatching { resultMarker.delete() }
        Log.i(tag, "RECEIVER_EXIT=ok")
    }
}
