import XCTest

/// Marketing-only XCUITest. Walks the iOS app through every screen worth
/// shipping in App Store screenshots and pauses 3.5s on each one so a
/// parallel bash runner (marketing/scripts/capture-ios.sh) can snap via
/// `xcrun simctl io <udid> screenshot` with descriptive filenames.
///
/// Sync protocol:
///   - The test writes /tmp/byoky-mkt-phase.txt with the current phase name.
///   - The bash runner polls that file. When it sees a new value, it snaps,
///     then writes /tmp/byoky-mkt-snapped to acknowledge.
///   - The test waits up to 6s for the ack, then advances.
///
/// Auto-setup config (/tmp/byoky-ios-test-config.json):
///   { "geminiKey": "...", "password": "..." }
final class ByokyMarketingTests: XCTestCase {
    private let phasePath = "/tmp/byoky-mkt-phase.txt"
    private let ackPath = "/tmp/byoky-mkt-snapped"

    override func setUpWithError() throws {
        continueAfterFailure = true
        try? FileManager.default.removeItem(atPath: phasePath)
        try? FileManager.default.removeItem(atPath: ackPath)
    }

    /// Mark a phase: writes phase name + waits for bash side to ack.
    private func phase(_ name: String, sleep s: TimeInterval = 1.5) {
        try? FileManager.default.removeItem(atPath: ackPath)
        try? name.write(toFile: phasePath, atomically: true, encoding: .utf8)
        // Give the UI a moment to settle, then wait for ack (cap at 6s).
        Thread.sleep(forTimeInterval: s)
        let deadline = Date().addingTimeInterval(6.0)
        while !FileManager.default.fileExists(atPath: ackPath) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }
    }

    func testCaptureMarketingScreens() throws {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard FileManager.default.fileExists(atPath: configPath) else {
            throw XCTSkip("Need \(configPath) — run via marketing/scripts/capture-ios.sh")
        }

        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launch()

        // ── 01: welcome / onboarding ────────────────────────────────────
        // Auto-setup may or may not run depending on config — try both paths.
        let getStarted = app.buttons["onboarding.getStarted"]
        if getStarted.waitForExistence(timeout: 5.0) {
            phase("01-welcome", sleep: 2.0)
            getStarted.tap()
        }

        // ── 02: post-onboarding dashboard with auto-setup credential ────
        // Wait for either the Gemini cell or the empty wallet state.
        let geminiCell = app.staticTexts["Google Gemini"]
        let emptyWallet = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'No keys'"))
            .firstMatch
        let appearedGemini = geminiCell.waitForExistence(timeout: 12.0)
        let appearedEmpty = emptyWallet.waitForExistence(timeout: 1.0)
        XCTAssertTrue(appearedGemini || appearedEmpty, "Dashboard never rendered")
        phase("02-dashboard", sleep: 2.0)

        // ── 03: open Settings tab if it exists ──────────────────────────
        if app.tabBars.buttons["Settings"].exists {
            app.tabBars.buttons["Settings"].tap()
            phase("03-settings", sleep: 1.5)
            // Back to wallet tab
            (app.tabBars.buttons["Wallet"].exists
                ? app.tabBars.buttons["Wallet"]
                : app.tabBars.buttons.firstMatch).tap()
            Thread.sleep(forTimeInterval: 0.6)
        }

        // ── 04: Gifts tab ──────────────────────────────────────────────
        let giftsTab = app.tabBars.buttons["Gifts"]
        XCTAssertTrue(giftsTab.waitForExistence(timeout: 5.0), "Gifts tab missing")
        giftsTab.tap()
        Thread.sleep(forTimeInterval: 1.0)
        phase("04-gifts-empty", sleep: 1.5)

        // ── 05: open Create Gift sheet ──────────────────────────────────
        let createGift = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'Create Gift'"))
            .firstMatch
        XCTAssertTrue(createGift.waitForExistence(timeout: 5.0))
        createGift.tap()
        Thread.sleep(forTimeInterval: 1.0)
        phase("05-create-gift-form", sleep: 2.0)

        // ── 06: pick custom budget 500 tokens ───────────────────────────
        let customToggle = app.buttons["createGift.customToggle"]
        if customToggle.waitForExistence(timeout: 5.0) {
            customToggle.tap()
            let customField = app.textFields["createGift.customTokens"]
            if customField.waitForExistence(timeout: 2.0) {
                customField.tap()
                customField.typeText("500")
                if app.keyboards.element.exists {
                    app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
                }
            }
        }
        phase("06-create-gift-filled", sleep: 1.5)

        // ── 07: submit + show generated link ────────────────────────────
        let submitBtn = app.buttons["createGift.submit"]
        for _ in 0..<6 where !submitBtn.waitForExistence(timeout: 0.5) {
            app.swipeUp()
        }
        if submitBtn.waitForExistence(timeout: 3.0) {
            submitBtn.tap()
            let linkText = app.staticTexts["createGift.link"]
            if linkText.waitForExistence(timeout: 15.0) {
                phase("07-gift-link-ready", sleep: 2.5)
                if app.buttons["createGift.done"].exists {
                    app.buttons["createGift.done"].tap()
                    Thread.sleep(forTimeInterval: 1.0)
                }
            }
        }

        // ── 08: gifts list with the new sent gift ───────────────────────
        phase("08-gifts-with-sent-gift", sleep: 2.0)

        // ── 09: back to dashboard ───────────────────────────────────────
        (app.tabBars.buttons["Wallet"].exists
            ? app.tabBars.buttons["Wallet"]
            : app.tabBars.buttons.firstMatch).tap()
        Thread.sleep(forTimeInterval: 0.8)
        phase("09-dashboard-final", sleep: 2.0)

        // Final marker so the runner knows we're done capturing.
        try? "DONE".write(toFile: phasePath, atomically: true, encoding: .utf8)
    }
}
