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

        // ── 03: Settings (from the wallet toolbar), Backup section on top ─
        let settingsButton = app.buttons["wallet.settings"]
        if settingsButton.waitForExistence(timeout: 5.0) {
            settingsButton.tap()
            let exportButton = app.buttons["settings.exportBackup"]
            if exportButton.waitForExistence(timeout: 5.0) {
                phase("03-settings-backup", sleep: 1.5)

                // ── 03b: Export Backup sheet ───────────────────────────
                exportButton.tap()
                let masterField = app.secureTextFields["exportBackup.masterPassword"]
                if masterField.waitForExistence(timeout: 5.0) {
                    phase("03b-export-backup", sleep: 1.5)
                    let close = app.buttons["exportBackup.close"]
                    if close.exists { close.tap() }
                    Thread.sleep(forTimeInterval: 0.8)
                }
            }
            let done = app.buttons["settings.done"]
            if done.waitForExistence(timeout: 3.0) {
                done.tap()
                Thread.sleep(forTimeInterval: 0.8)
            }
        }

        // ── 04: Apps tab (empty) ───────────────────────────────────────
        let appsTab = app.tabBars.buttons["Apps"]
        XCTAssertTrue(appsTab.waitForExistence(timeout: 5.0), "Apps tab missing")
        appsTab.tap()
        Thread.sleep(forTimeInterval: 1.0)
        phase("04-apps-empty", sleep: 1.5)

        // ── 05: Add app by URL ─────────────────────────────────────────
        let addEmpty = app.buttons["apps.addAppEmpty"]
        let addToolbar = app.buttons["apps.addApp"]
        if addEmpty.waitForExistence(timeout: 3.0) {
            addEmpty.tap()
        } else {
            XCTAssertTrue(addToolbar.waitForExistence(timeout: 3.0), "Add app button missing")
            addToolbar.tap()
        }
        let urlField = app.textFields["addApp.url"]
        XCTAssertTrue(urlField.waitForExistence(timeout: 5.0), "Add app sheet missing")
        urlField.tap()
        urlField.typeText("byoky.com/chat")
        let nameField = app.textFields["addApp.name"]
        if nameField.waitForExistence(timeout: 2.0) {
            nameField.tap()
            nameField.typeText("Byoky Chat")
        }
        phase("05-add-app-form", sleep: 1.5)

        // ── 06: the new app opens in the in-wallet browser ─────────────
        let submit = app.buttons["addApp.submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 3.0))
        submit.tap()
        let closeRuntime = app.buttons["appRuntime.close"]
        if closeRuntime.waitForExistence(timeout: 10.0) {
            Thread.sleep(forTimeInterval: 3.0) // let the page load
            phase("06-app-runtime", sleep: 1.5)
            closeRuntime.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }

        // ── 07: Apps grid with the added app ───────────────────────────
        phase("07-apps-grid", sleep: 1.5)

        // ── 08: Connected apps + routing groups ────────────────────────
        let connectedTab = app.tabBars.buttons["Connected"]
        XCTAssertTrue(connectedTab.waitForExistence(timeout: 5.0), "Connected tab missing")
        connectedTab.tap()
        Thread.sleep(forTimeInterval: 1.0)
        phase("08-connected-apps", sleep: 1.5)

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
