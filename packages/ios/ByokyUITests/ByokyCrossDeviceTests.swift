import XCTest

/// iOS-as-sender half of the cross-device gift flow test.
///
/// Drives the iPhone simulator through: reset → create wallet offline →
/// import a real Gemini key (from env) → create a tiny gift → read the
/// generated link from the Gift Created screen → write the link to a file
/// so the desktop-side Playwright spec can redeem it and try to use it.
///
/// This is the side that will expose COD-13 — on iOS the sender never
/// registers as `role: sender` on the relay, so the desktop recipient's
/// peerOnline probe will return false and the gift will fail. The iOS
/// portion of the flow (through "Gift Created") works; the relay wiring
/// is what's broken.
///
/// Run:
///   BYOKY_GEMINI_KEY=... \
///   BYOKY_GIFT_LINK_OUT=/tmp/byoky-ios-gift-link.txt \
///     xcodebuild test -project Byoky.xcodeproj -scheme Byoky \
///       -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
///       -only-testing:ByokyUITests/ByokyCrossDeviceTests
final class ByokyCrossDeviceTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testIOSSenderCreatesGift() throws {
        // xcodebuild's TEST_RUNNER_* env forwarding is unreliable for UI
        // test hosts, so the orchestrator writes the Gemini key and output
        // path to /tmp/byoky-ios-test-config.json instead. The XCUITest
        // runner process reads it from disk — same Mac, same filesystem.
        let configPath = "/tmp/byoky-ios-test-config.json"
        guard let configData = FileManager.default.contents(atPath: configPath) else {
            throw XCTSkip("Test config missing at \(configPath) — run via scripts/run-cross-device-ios.sh so the orchestrator writes it.")
        }
        guard let config = try JSONSerialization.jsonObject(with: configData) as? [String: String],
              let geminiKey = config["geminiKey"], !geminiKey.isEmpty else {
            throw XCTSkip("Test config at \(configPath) missing geminiKey")
        }
        let outputPath = config["giftLinkOut"] ?? "/tmp/byoky-ios-gift-link.txt"

        let app = XCUIApplication()
        // -byokyResetOnLaunch wipes keychain before the app wires up its
        // shared WalletStore, so we always start on the welcome screen.
        // Environment (not launchArguments) for the Gemini key so it
        // doesn't end up in XCTest logs that get attached to xcresult.
        app.launchArguments = ["-byokyResetOnLaunch", "1", "-byokyUITest", "1"]
        app.launch()

        // ── 1. Onboarding → offline setup ──────────────────────────────
        let offlineBtn = app.buttons["onboarding.offlineMode"]
        XCTAssertTrue(offlineBtn.waitForExistence(timeout: 10.0), "Welcome screen missing")
        offlineBtn.tap()

        let pwField = app.secureTextFields["onboarding.password"]
        XCTAssertTrue(pwField.waitForExistence(timeout: 5.0), "Password field missing")
        pwField.tap()
        pwField.typeText("CrossDeviceTest1234!")

        let confirmField = app.secureTextFields["onboarding.confirmPassword"]
        confirmField.tap()
        confirmField.typeText("CrossDeviceTest1234!")

        let createBtn = app.buttons["onboarding.createWallet"]
        XCTAssertTrue(createBtn.waitForExistence(timeout: 2.0))
        // Dismiss the keyboard so the Create Wallet button is hittable —
        // on some simulators the keyboard covers the button. An explicit
        // tap on the safe area works better than relying on return-to-
        // dismiss from the SecureField.
        if app.keyboards.element.exists {
            // Tap a neutral region to drop the keyboard.
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        }
        // Poll until hittable; the layout settles after the keyboard drops.
        let hittablePredicate = NSPredicate(format: "isHittable == true")
        let hittable = XCTNSPredicateExpectation(predicate: hittablePredicate, object: createBtn)
        _ = XCTWaiter().wait(for: [hittable], timeout: 5.0)
        createBtn.tap()

        // ── 2. Wait for Wallet screen → empty state Add button ────────
        // Skip checking the tab bar by identifier — UITabBar items don't
        // reliably surface our SwiftUI accessibility IDs. Wait for the
        // empty-state button on the first tab (Wallet) instead.
        let addFromEmpty = app.buttons["wallet.addCredentialEmpty"]
        if !addFromEmpty.waitForExistence(timeout: 20.0) {
            print("=== POST-CREATE-WALLET TREE ===")
            print(app.debugDescription)
            print("=== END TREE ===")
            XCTFail("Empty-state add-credential button never appeared — wallet create likely failed")
        }
        addFromEmpty.tap()

        // ── 3. Pick Gemini + enter credentials ─────────────────────────
        let geminiRow = app.cells.containing(.staticText, identifier: "addCredential.provider.gemini").firstMatch
        let geminiNav = app.descendants(matching: .any)["addCredential.provider.gemini"]
        // Two lookup shapes because SwiftUI NavigationLink rows can surface
        // as either a cell with a matching static text, or as a button/any
        // element with the identifier directly depending on list style.
        if geminiNav.waitForExistence(timeout: 5.0) {
            geminiNav.tap()
        } else if geminiRow.exists {
            geminiRow.tap()
        } else {
            XCTFail("Gemini provider row not found")
        }

        let labelField = app.textFields["credentialEntry.label"]
        XCTAssertTrue(labelField.waitForExistence(timeout: 5.0), "Credential label field missing")
        // Label is pre-filled with "Google Gemini" — clear it first.
        labelField.tap()
        labelField.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 1.0) {
            app.menuItems["Select All"].tap()
        }
        labelField.typeText("Cross-Device Gemini")

        let keyField = app.secureTextFields["credentialEntry.apiKey"]
        XCTAssertTrue(keyField.waitForExistence(timeout: 2.0), "API key field missing")
        keyField.tap()
        keyField.typeText(geminiKey)

        app.buttons["credentialEntry.save"].tap()

        // ── 4. Navigate to Gifts tab ───────────────────────────────────
        // SwiftUI TabView surfaces tab items as UITabBar buttons with the
        // visible label as the identifier — our `tab.gifts` accessibility
        // identifier doesn't propagate to the UITabBar button at all.
        // Target by label text instead.
        let giftsTabButton = app.tabBars.buttons["Gifts"]
        XCTAssertTrue(giftsTabButton.waitForExistence(timeout: 10.0), "Gifts tab bar button missing")
        giftsTabButton.tap()

        // Gifts tab shows empty-state "Create Gift" button since the wallet
        // has no gifts yet. NavigationLinks may surface as buttons or other
        // element types depending on the context — try multiple queries.
        Thread.sleep(forTimeInterval: 1.0)
        let createGiftBtn = app.buttons["gifts.createGift"]
        let createGiftAny = app.descendants(matching: .any)["gifts.createGift"]
        if createGiftBtn.waitForExistence(timeout: 3.0) {
            createGiftBtn.tap()
        } else if createGiftAny.exists {
            createGiftAny.tap()
        } else {
            // Fall back to label text — "Create Gift" appears in the
            // NavigationLink's visible label.
            let byText = app.buttons["Create Gift"]
            if byText.waitForExistence(timeout: 3.0) {
                byText.tap()
            } else {
                print("=== GIFTS TAB TREE ===")
                print(app.debugDescription)
                print("=== END TREE ===")
                XCTFail("Create-gift entry not found by identifier or label text")
            }
        }

        // ── 5. Fill out the gift form ──────────────────────────────────
        // The credential auto-selects to the first available (Gemini). The
        // default preset is 100K — switch to Custom and enter 500 so we
        // don't sink real budget into the test.
        let customToggle = app.buttons["createGift.customToggle"]
        XCTAssertTrue(customToggle.waitForExistence(timeout: 5.0), "Custom-tokens toggle missing")
        customToggle.tap()

        let customField = app.textFields["createGift.customTokens"]
        XCTAssertTrue(customField.waitForExistence(timeout: 2.0), "Custom-tokens input missing")
        customField.tap()
        customField.typeText("500")

        app.buttons["createGift.submit"].tap()

        // ── 6. Read the generated gift link ────────────────────────────
        let linkText = app.staticTexts["createGift.link"]
        XCTAssertTrue(linkText.waitForExistence(timeout: 10.0), "Gift link text never appeared")
        let linkValue = linkText.label
        XCTAssertTrue(
            linkValue.hasPrefix("https://byoky.com/gift") || linkValue.hasPrefix("byoky://gift"),
            "Gift link value doesn't look like a gift link: \(linkValue)"
        )

        // ── 7. Persist the link for the desktop side to pick up ───────
        try linkValue.write(toFile: outputPath, atomically: true, encoding: .utf8)
        print("[ByokyCrossDeviceTests] gift link written to \(outputPath)")
        print("[ByokyCrossDeviceTests] GIFT_LINK=\(linkValue)")

        // Tap Done so the app returns to a settled state. If the sender
        // relay code existed, this is where the WebSocket would stay open
        // and accept relay:request messages from the desktop recipient —
        // today the socket never opens, which is what COD-13 tracks.
        app.buttons["createGift.done"].tap()
    }
}
