import XCTest

/// iOS-as-sender half of the cross-device gift flow test.
///
/// The orchestrator (scripts/run-cross-device-ios.sh) writes a config file
/// to /tmp/byoky-ios-test-config.json with the Gemini key. On launch the
/// app reads it (-byokyUITest flag) and auto-creates the wallet + imports
/// the credential. The XCUITest then starts with a fully-set-up wallet and
/// only needs to drive the gift-creation UI.
///
/// Run via:  ./scripts/run-cross-device-ios.sh
final class ByokyCrossDeviceTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testIOSSenderCreatesGift() throws {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard let configData = FileManager.default.contents(atPath: configPath),
              let config = try JSONSerialization.jsonObject(with: configData) as? [String: Any],
              let geminiKey = config["geminiKey"] as? String, !geminiKey.isEmpty else {
            throw XCTSkip("Config missing at \(configPath) — run via scripts/run-cross-device-ios.sh")
        }
        let outputPath = (config["giftLinkOut"] as? String) ?? "/tmp/byoky-ios-gift-link.txt"

        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launch()

        // ── 1. Verify auto-setup worked — credential visible on Wallet ──
        // Give the app a moment to settle after auto-setup.
        Thread.sleep(forTimeInterval: 2.0)
        let credentialText = app.staticTexts["Google Gemini"]
        if !credentialText.waitForExistence(timeout: 15.0) {
            let screenshot = app.screenshot()
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/byoky-auto-setup-failure.png"))
            XCTFail("Auto-setup failed — screenshot at /tmp/byoky-auto-setup-failure.png")
            return
        }

        // ── 2. Navigate to Gifts tab ───────────────────────────────────
        let giftsTab = app.tabBars.buttons["Gifts"]
        XCTAssertTrue(giftsTab.waitForExistence(timeout: 5.0), "Gifts tab missing")
        giftsTab.tap()

        Thread.sleep(forTimeInterval: 1.0)
        // The empty-state or actions section has a "Create Gift" link.
        let createGift = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'Create Gift'"))
            .firstMatch
        if !createGift.waitForExistence(timeout: 5.0) {
            let screenshot = app.screenshot()
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/byoky-gifts-tab-failure.png"))
            XCTFail("Create Gift entry not found — screenshot at /tmp/byoky-gifts-tab-failure.png")
            return
        }
        createGift.tap()

        // ── 3. Fill out the gift form ──────────────────────────────────
        let customToggle = app.buttons["createGift.customToggle"]
        XCTAssertTrue(customToggle.waitForExistence(timeout: 5.0), "Custom-tokens toggle missing")
        customToggle.tap()

        let customField = app.textFields["createGift.customTokens"]
        XCTAssertTrue(customField.waitForExistence(timeout: 2.0), "Custom-tokens input missing")
        customField.tap()
        customField.typeText("500")

        // Dismiss keyboard, then scroll the form so the submit button
        // enters the viewport. SwiftUI Form lazy-loads cells — bottom
        // sections don't exist in the accessibility tree until scrolled.
        if app.keyboards.element.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
            Thread.sleep(forTimeInterval: 0.5)
        }
        app.swipeUp()
        let submitBtn = app.buttons["createGift.submit"]
        XCTAssertTrue(submitBtn.waitForExistence(timeout: 5.0), "Create Gift submit button not found after scroll")
        submitBtn.tap()

        // ── 4. Read the generated gift link ────────────────────────────
        let linkText = app.staticTexts["createGift.link"]
        XCTAssertTrue(linkText.waitForExistence(timeout: 15.0), "Gift link text never appeared")
        let linkValue = linkText.label
        XCTAssertTrue(
            linkValue.hasPrefix("https://byoky.com/gift") || linkValue.hasPrefix("byoky://gift"),
            "Gift link doesn't look right: \(linkValue)"
        )

        // ── 5. Persist the link for the desktop side ───────────────────
        try linkValue.write(toFile: outputPath, atomically: true, encoding: .utf8)

        app.buttons["createGift.done"].tap()
    }
}
