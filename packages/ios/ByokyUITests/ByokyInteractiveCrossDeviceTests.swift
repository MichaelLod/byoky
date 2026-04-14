import XCTest

/// Two XCUITests that pair with `e2e/tests/interactive-cross-device.spec.ts`
/// to exercise the full iOS ↔ desktop-extension gift round-trip (both
/// directions) plus real API proxying through the gift relay.
///
/// Why two tests instead of one big one: each XCUITest launches its own app
/// instance, and the orchestrator (`scripts/run-interactive-cross-device.sh`)
/// rewrites `/tmp/byoky-ios-test-config.json` between stages — gemini-only
/// for the "iOS sends" leg, anthropic-only + `fireAfterSetup` for the
/// "iOS redeems" leg. Both tests block on sentinel files so the app stays
/// foregrounded long enough for the relay sockets to do their work.
final class ByokyInteractiveCrossDeviceTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - Leg 1: iOS as sender, desktop redeems + proxies

    /// Creates a small Gemini gift, writes the link to disk for the desktop
    /// side, then blocks until the Playwright spec signals it's done. While
    /// blocking, `GiftRelayHost` stays connected so the desktop extension
    /// can round-trip real Gemini requests through iOS's key.
    func testIOSSendsGift_Interactive() throws {
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard FileManager.default.fileExists(atPath: configPath) else {
            throw XCTSkip("Config missing at \(configPath) — run via scripts/run-interactive-cross-device.sh")
        }

        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launch()

        // Give auto-setup a beat to run and import the Gemini key.
        Thread.sleep(forTimeInterval: 2.0)
        XCTAssertTrue(
            app.staticTexts["Google Gemini"].waitForExistence(timeout: 15.0),
            "Auto-setup didn't import the Gemini credential — check /tmp/byoky-ios-test-config.json"
        )

        // Gifts tab → Create Gift.
        let giftsTab = app.tabBars.buttons["Gifts"]
        XCTAssertTrue(giftsTab.waitForExistence(timeout: 5.0))
        giftsTab.tap()

        Thread.sleep(forTimeInterval: 1.0)
        let createGift = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'Create Gift'"))
            .firstMatch
        XCTAssertTrue(createGift.waitForExistence(timeout: 5.0), "Create Gift entry missing")
        createGift.tap()

        // Set a small 500-token budget so we can't accidentally blow the key.
        let customToggle = app.buttons["createGift.customToggle"]
        XCTAssertTrue(customToggle.waitForExistence(timeout: 5.0))
        customToggle.tap()
        let customField = app.textFields["createGift.customTokens"]
        XCTAssertTrue(customField.waitForExistence(timeout: 2.0))
        customField.tap()
        customField.typeText("500")

        if app.keyboards.element.exists {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1)).tap()
        }
        // The Create Gift form is longer than the screen — credential list,
        // token budget, expiry, relay URL, marketplace, then submit at the
        // bottom. SwiftUI Form is lazily-rendered, so the submit row isn't
        // in the a11y tree until we scroll down to it. Swipe up until the
        // button exists (bounded so we bail on a real failure).
        let submitBtn = app.buttons["createGift.submit"]
        for _ in 0..<6 where !submitBtn.waitForExistence(timeout: 0.5) {
            app.swipeUp()
        }
        XCTAssertTrue(submitBtn.waitForExistence(timeout: 3.0), "Create Gift submit never scrolled into view")
        submitBtn.tap()

        // Read the generated link and hand it to the desktop side.
        let linkText = app.staticTexts["createGift.link"]
        XCTAssertTrue(linkText.waitForExistence(timeout: 15.0), "Gift link never appeared")
        let linkValue = linkText.label
        XCTAssertTrue(
            linkValue.hasPrefix("https://byoky.com/gift") || linkValue.hasPrefix("byoky://gift"),
            "Gift link looks wrong: \(linkValue)"
        )

        let linkOut = "/tmp/byoky-ios-gift-link.txt"
        try linkValue.write(toFile: linkOut, atomically: true, encoding: .utf8)
        print("[iOS-send] wrote gift link to \(linkOut)")

        // Tap Done to return to the Gifts list — keeps the sent-gift card
        // visible in the sim so you can see the relay is live.
        app.buttons["createGift.done"].tap()

        // Block until Playwright tells us it's done. Cap at 5 minutes so a
        // hung run doesn't wedge the simulator forever.
        let doneSignal = "/tmp/byoky-ios-done.sig"
        print("[iOS-send] waiting for \(doneSignal) (desktop is proxying through the relay)…")
        let deadline = Date().addingTimeInterval(300)
        while !FileManager.default.fileExists(atPath: doneSignal) {
            if Date() > deadline {
                XCTFail("Desktop-side never signalled done within 5 minutes")
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        try? FileManager.default.removeItem(atPath: doneSignal)
        print("[iOS-send] done — desktop finished redeem + proxy")
    }

    // MARK: - Leg 2: desktop sends gift, iOS redeems + fires a real call

    /// Waits for the desktop spec to drop a gift link, pastes it into the
    /// Redeem Gift sheet, accepts it, then lets `fireAfterSetup` (in
    /// ByokyApp.autoSetupIfNeeded) fire a real Anthropic request via the
    /// gift relay and write the result to /tmp for Playwright to assert.
    func testIOSRedeemsGift_Interactive() throws {
        let linkIn = "/tmp/byoky-desktop-gift-link.txt"
        let resultOut = "/tmp/byoky-ios-proxy-result.json"
        try? FileManager.default.removeItem(atPath: resultOut)

        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launch()

        // Wait for onboarding to complete (auto-setup writes password,
        // imports no credentials in this stage — iOS only needs the gift).
        Thread.sleep(forTimeInterval: 2.0)

        // Wait for the desktop side to produce a gift link.
        print("[iOS-recv] waiting for \(linkIn)…")
        let deadline = Date().addingTimeInterval(120)
        while !FileManager.default.fileExists(atPath: linkIn) {
            if Date() > deadline {
                XCTFail("No gift link from desktop after 2min — orchestrator may have failed")
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        let link = try String(contentsOfFile: linkIn, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        print("[iOS-recv] got link: \(link.prefix(60))…")

        // Gifts tab → Redeem Gift.
        let giftsTab = app.tabBars.buttons["Gifts"]
        XCTAssertTrue(giftsTab.waitForExistence(timeout: 10.0))
        giftsTab.tap()
        Thread.sleep(forTimeInterval: 1.0)

        let redeemEntry = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] 'Redeem Gift'"))
            .firstMatch
        XCTAssertTrue(redeemEntry.waitForExistence(timeout: 5.0), "Redeem Gift entry missing")
        redeemEntry.tap()

        // Paste the link into the TextEditor.
        let linkField = app.textViews["redeemGift.link"]
        XCTAssertTrue(linkField.waitForExistence(timeout: 5.0), "redeemGift.link field missing")
        linkField.tap()
        // `typeText` is slow for long strings but deterministic — paste via
        // UIPasteboard would need an entitlement dance.
        linkField.typeText(link)

        // Accept — the button enables once parsing succeeds.
        let acceptBtn = app.buttons["redeemGift.accept"]
        XCTAssertTrue(acceptBtn.waitForExistence(timeout: 5.0))
        // Parsing can take a moment for long payloads; poll for enabled.
        let enableDeadline = Date().addingTimeInterval(10)
        while !acceptBtn.isEnabled && Date() < enableDeadline {
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTAssertTrue(acceptBtn.isEnabled, "Accept Gift never enabled — link invalid?")
        acceptBtn.tap()

        // Now fireAfterSetup (running as a detached Task from ByokyApp.init)
        // polls for the redeemed gift, sends a real request through the
        // relay, and writes the result JSON. Wait for that file.
        print("[iOS-recv] gift redeemed — waiting for auto-fire result at \(resultOut)…")
        let fireDeadline = Date().addingTimeInterval(120)
        while !FileManager.default.fileExists(atPath: resultOut) {
            if Date() > fireDeadline {
                XCTFail("Auto-fire result never appeared within 2min")
                return
            }
            Thread.sleep(forTimeInterval: 0.5)
        }
        // Give Playwright a moment to read it before we tear down.
        Thread.sleep(forTimeInterval: 2.0)
        print("[iOS-recv] auto-fire complete")
    }
}
