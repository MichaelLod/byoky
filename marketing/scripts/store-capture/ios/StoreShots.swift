import XCTest

/// Store screenshots for Byoky 1.1.1. run.sh copies this into a scratch copy
/// of packages/ios together with MarketingSeed.swift. Runs on an iPhone 6.9"
/// and an iPad 13" simulator; names are prefixed with the device kind.
final class StoreShots: XCTestCase {
    let password = "Muninn-Demo-2026!"
    lazy var out: String = ProcessInfo.processInfo.environment["STORE_OUT"] ?? "/tmp/byoky-store-shots"
    lazy var kind: String = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"

    override func setUpWithError() throws {
        continueAfterFailure = true
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
    }

    func shot(_ name: String, wait: TimeInterval = 1.2) {
        Thread.sleep(forTimeInterval: wait)
        let png = XCUIScreen.main.screenshot().pngRepresentation
        try? png.write(to: URL(fileURLWithPath: "\(out)/\(kind)-\(name).png"))
    }

    func dismissSavePassword(_ app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(4)
        while Date() < deadline {
            for b in [app.buttons["Not Now"], springboard.buttons["Not Now"]] where b.exists {
                b.tap(); Thread.sleep(forTimeInterval: 0.8); return
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
    }

    func tab(_ app: XCUIApplication, _ name: String) {
        let b = app.tabBars.buttons[name]
        if b.waitForExistence(timeout: 3) { b.tap() } else { app.buttons[name].firstMatch.tap() }
        Thread.sleep(forTimeInterval: 0.8)
    }

    func testWelcome() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch"]
        app.launch()
        XCTAssertTrue(app.buttons["onboarding.getStarted"].waitForExistence(timeout: 15))
        shot("welcome", wait: 2.0)
    }

    func testTour() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest",
                               "-byoky_revokedAppOrigins", "(\"https://notes.example.com\")"]
        app.launch()

        // Wallet with three keys and a week of usage.
        XCTAssertTrue(app.staticTexts["Anthropic"].firstMatch.waitForExistence(timeout: 20), "wallet")
        dismissSavePassword(app)
        shot("wallet", wait: 2.0)

        // Usage for one key.
        app.staticTexts["Anthropic"].firstMatch.tap()
        shot("stats", wait: 1.5)
        if app.buttons["Close"].exists { app.buttons["Close"].tap() }
        Thread.sleep(forTimeInterval: 0.8)

        // Apps added by address.
        tab(app, "Apps")
        shot("apps")

        // Notes was disconnected earlier: it asks before reconnecting.
        let notes = app.staticTexts["Notes"].firstMatch
        if notes.waitForExistence(timeout: 3) {
            notes.tap()
            if app.buttons["Reconnect"].waitForExistence(timeout: 5) {
                shot("reconnect", wait: 1.5)
                app.buttons["Cancel"].firstMatch.tap()
                Thread.sleep(forTimeInterval: 0.8)
            }
        }

        // Add an app by address.
        let add = app.buttons["apps.addApp"]
        if add.waitForExistence(timeout: 3) {
            add.tap()
            let url = app.textFields["addApp.url"]
            if url.waitForExistence(timeout: 5) {
                url.tap()
                url.typeText("byoky.com/chat")
                let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                for b in [app.buttons["Continue"], springboard.buttons["Continue"]] where b.exists { b.tap() }
                Thread.sleep(forTimeInterval: 0.6)
                shot("add-app", wait: 1.0)
                if app.buttons["Cancel"].exists { app.buttons["Cancel"].firstMatch.tap() }
                Thread.sleep(forTimeInterval: 0.8)
            }
        }

        // Connected apps, grouped.
        tab(app, "Connected")
        shot("connected", wait: 1.5)

        // Token limit for byoky.com.
        let demoRow = app.staticTexts["byoky.com"].firstMatch
        if demoRow.waitForExistence(timeout: 3) {
            demoRow.press(forDuration: 1.2)
            let limit = app.buttons["Set token limit"]
            if limit.waitForExistence(timeout: 3) {
                limit.tap()
                shot("allowance", wait: 1.5)
                app.buttons["Cancel"].firstMatch.tap()
                Thread.sleep(forTimeInterval: 0.8)
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()
            }
        }

        // Move chat.example.com between groups.
        let chatRow = app.staticTexts["chat.example.com"].firstMatch
        if chatRow.waitForExistence(timeout: 3) {
            chatRow.press(forDuration: 1.2)
            let move = app.buttons["Move to group"]
            if move.waitForExistence(timeout: 3) {
                move.tap()
                shot("move-to-group", wait: 1.5)
                app.buttons["Cancel"].firstMatch.tap()
                Thread.sleep(forTimeInterval: 0.8)
            } else {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()
            }
        }

        // Settings, then lock: Muninn goes to sleep.
        tab(app, "Wallet")
        app.buttons["wallet.settings"].tap()
        XCTAssertTrue(app.buttons["settings.lock"].waitForExistence(timeout: 5))
        shot("settings")
        app.buttons["settings.lock"].tap()
        XCTAssertTrue(app.secureTextFields["unlock.password"].waitForExistence(timeout: 5))
        shot("lock", wait: 1.5)
    }
}
