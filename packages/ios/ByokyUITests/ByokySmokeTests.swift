import XCTest

/// Smoke test — proves the XCUITest target boots and the Byoky app launches
/// to a known entry screen. This is deliberately minimal; the screen walk
/// (wallet, apps, connected apps) lives in ByokyMarketingTests.
final class ByokySmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Launch and assert the welcome screen renders. If this fails the whole
    /// UI test harness is broken — fix it before touching anything else.
    func testAppLaunchesToWelcome() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-byokyUITest", "1"]
        app.launch()

        // Give the app a moment to render its first frame, then dump the
        // accessibility tree so we can see what identifiers are actually
        // bubbling up. This makes identifier gaps obvious at test time.
        Thread.sleep(forTimeInterval: 2.0)
        print("=== ACCESSIBILITY TREE ===")
        print(app.debugDescription)
        print("=== END TREE ===")

        let getStarted = app.buttons["onboarding.getStarted"]
        let unlockPassword = app.secureTextFields["unlock.password"]
        let walletTab = app.buttons["tab.wallet"]

        let found = getStarted.waitForExistence(timeout: 5.0)
            || unlockPassword.waitForExistence(timeout: 1.0)
            || walletTab.waitForExistence(timeout: 1.0)

        XCTAssertTrue(
            found,
            "App did not reach a known entry screen (uninitialized / locked / unlocked)."
        )
    }
}

/// Wallet, Apps and Connected screens: what VoiceOver reads, tap targets,
/// confirmations and the in-wallet browser's error state. Each test starts
/// from a fresh wallet (reset on launch, onboarding through the UI).
final class ByokyWalletUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launch()
        createWallet()
    }

    private func createWallet() {
        let getStarted = app.buttons["onboarding.getStarted"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 10), "a reset wallet starts at onboarding")
        getStarted.tap()
        let password = app.secureTextFields["onboarding.password"]
        XCTAssertTrue(password.waitForExistence(timeout: 5))
        password.tap()
        password.typeText("CorrectHorse12!")
        let confirm = app.secureTextFields["onboarding.confirmPassword"]
        confirm.tap()
        confirm.typeText("CorrectHorse12!")
        app.buttons["onboarding.createWallet"].tap()
        XCTAssertTrue(app.buttons["wallet.settings"].waitForExistence(timeout: 30))
    }

    private func addOpenAIKey() {
        app.buttons["fab.button"].tap()
        let addCredential = app.buttons["fab.menu.addCredential"]
        XCTAssertTrue(addCredential.waitForExistence(timeout: 5))
        addCredential.tap()
        let openai = app.buttons["addCredential.provider.openai"]
        XCTAssertTrue(openai.waitForExistence(timeout: 5))
        openai.tap()
        let key = app.secureTextFields["credentialEntry.apiKey"]
        XCTAssertTrue(key.waitForExistence(timeout: 5))
        key.tap()
        key.typeText("sk-test-not-a-real-key")
        app.buttons["credentialEntry.save"].tap()
        XCTAssertTrue(app.buttons["wallet.credential.rename"].waitForExistence(timeout: 10))
    }

    private func addApp(_ address: String, name: String) {
        app.tabBars.buttons["Apps"].tap()
        let empty = app.buttons["apps.addAppEmpty"]
        if empty.waitForExistence(timeout: 2) { empty.tap() } else { app.buttons["apps.addApp"].tap() }
        let url = app.textFields["addApp.url"]
        XCTAssertTrue(url.waitForExistence(timeout: 5))
        url.tap()
        url.typeText(address)
        let nameField = app.textFields["addApp.name"]
        nameField.tap()
        nameField.typeText(name)
        app.buttons["addApp.submit"].tap()
    }

    /// Controls read their purpose, not SF Symbol or asset names.
    func testVoiceOverLabels() {
        XCTAssertEqual(app.buttons["wallet.settings"].label, "Settings")

        app.buttons["fab.button"].tap()
        let addApp = app.buttons["fab.menu.addApp"]
        XCTAssertTrue(addApp.waitForExistence(timeout: 5))
        XCTAssertEqual(addApp.label, "Add app")
        app.buttons["fab.menu.addCredential"].tap()
        XCTAssertTrue(app.buttons["addCredential.provider.openai"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.images["provider-openai"].exists, "provider mark exposed by its asset name")
        app.buttons["addCredential.provider.openai"].tap()
        let key = app.secureTextFields["credentialEntry.apiKey"]
        XCTAssertTrue(key.waitForExistence(timeout: 5))
        key.tap()
        key.typeText("sk-test-not-a-real-key")
        app.buttons["credentialEntry.save"].tap()

        let usage = app.buttons["wallet.credential.usage"]
        XCTAssertTrue(usage.waitForExistence(timeout: 10))
        XCTAssertTrue(usage.label.contains("0 requests"), usage.label)
        XCTAssertTrue(usage.label.contains("0 input tokens"), usage.label)
        usage.tap()
        let week = app.buttons["walletStats.range.7d"]
        XCTAssertTrue(week.waitForExistence(timeout: 5))
        XCTAssertEqual(week.label, "Last 7 days")
        XCTAssertTrue(week.isSelected)
        XCTAssertFalse(app.buttons["walletStats.range.24h"].isSelected)
        app.buttons["walletStats.range.24h"].tap()
        XCTAssertTrue(app.buttons["walletStats.range.24h"].isSelected)
    }

    /// A blank label can't be saved.
    func testRenameToBlankCannotBeSaved() {
        addOpenAIKey()
        app.buttons["wallet.credential.rename"].tap()
        // Alert text fields don't carry SwiftUI identifiers.
        let field = app.alerts.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let current = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        let save = app.alerts.buttons["wallet.renameCredential.save"].firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        XCTAssertFalse(save.isEnabled)
        field.typeText("Work key")
        XCTAssertTrue(save.isEnabled)
        save.tap()
        XCTAssertTrue(app.staticTexts["Work key"].waitForExistence(timeout: 5))
    }

    /// A disabled app says it's disabled and offers to enable it.
    func testTappingADisabledAppOffersToEnableIt() {
        addApp("disabled-app.invalid", name: "Sleepy")
        let close = app.buttons["appRuntime.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        close.tap()

        let tile = app.buttons["Sleepy"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        tile.press(forDuration: 1.2)
        let disable = app.buttons["Disable"]
        XCTAssertTrue(disable.waitForExistence(timeout: 5))
        disable.tap()

        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        XCTAssertEqual(tile.value as? String, "Disabled")
        tile.tap()
        let enable = app.buttons["Enable"]
        XCTAssertTrue(enable.waitForExistence(timeout: 5), "disabled app tap showed no options")
        XCTAssertTrue(app.buttons["Enable and Open"].exists)
        enable.tap()
        XCTAssertTrue(tile.waitForExistence(timeout: 5))
        XCTAssertNotEqual(tile.value as? String, "Disabled")
    }

    /// Deleting a group asks first.
    func testDeletingAGroupAsksFirst() {
        app.tabBars.buttons["Connected"].tap()
        let create = app.buttons["groups.create"]
        XCTAssertTrue(create.waitForExistence(timeout: 5))
        create.tap()
        let name = app.textFields["groupEditor.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Coding")
        app.buttons["groupEditor.save"].tap()

        let options = app.buttons["Options for Coding"]
        XCTAssertTrue(options.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(options.frame.width, 44)
        XCTAssertGreaterThanOrEqual(options.frame.height, 44)
        options.tap()
        app.buttons["Delete"].tap()
        let alert = app.alerts["Delete group \"Coding\"?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "group deleted without asking")
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(options.waitForExistence(timeout: 5))

        options.tap()
        app.buttons["Delete"].tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["Delete"].tap()
        XCTAssertFalse(options.waitForExistence(timeout: 2))
    }

    /// Small icon buttons have a 44pt hit area.
    func testIconButtonsAreAtLeast44Points() {
        addOpenAIKey()
        let rename = app.buttons["wallet.credential.rename"]
        XCTAssertGreaterThanOrEqual(rename.frame.width, 44)
        XCTAssertGreaterThanOrEqual(rename.frame.height, 44)

        app.buttons["wallet.settings"].tap()
        let lock = app.buttons["settings.lock"]
        XCTAssertTrue(lock.waitForExistence(timeout: 5))
        lock.tap()
        let eye = app.buttons["Show password"]
        XCTAssertTrue(eye.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(eye.frame.width, 44)
        XCTAssertGreaterThanOrEqual(eye.frame.height, 44)
    }

    /// No http://localhost prefill for a server that can't run on the
    /// phone, and a setup token is badged "Setup Token".
    func testCredentialForms() {
        app.buttons["fab.button"].tap()
        app.buttons["fab.menu.addCredential"].tap()
        let ollama = app.buttons["addCredential.provider.ollama"]
        XCTAssertTrue(ollama.waitForExistence(timeout: 5) || { app.swipeUp(); return ollama.waitForExistence(timeout: 2) }())
        if !ollama.isHittable { app.swipeUp() }
        ollama.tap()
        let server = app.textFields["credentialEntry.baseUrl"]
        XCTAssertTrue(server.waitForExistence(timeout: 5))
        let shown = server.value as? String ?? ""
        XCTAssertFalse(shown.contains("localhost"), "server URL prefilled with \(shown)")
        XCTAssertTrue(shown.hasPrefix("https://"), "placeholder \(shown)")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        let anthropic = app.buttons["addCredential.provider.anthropic"]
        if !anthropic.isHittable { app.swipeDown() }
        XCTAssertTrue(anthropic.waitForExistence(timeout: 5))
        anthropic.tap()
        let setupToken = app.buttons["credentialEntry.authMethod.setupToken"]
        XCTAssertTrue(setupToken.waitForExistence(timeout: 5))
        setupToken.tap()
        let key = app.secureTextFields["credentialEntry.apiKey"]
        key.tap()
        key.typeText("sk-ant-oat01-not-a-real-token")
        app.buttons["credentialEntry.save"].tap()
        XCTAssertTrue(app.buttons["wallet.credential.rename"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Setup Token"].exists)
        XCTAssertFalse(app.staticTexts["OAuth"].exists)
    }

    /// Settings explains the Safari extension.
    func testSettingsExplainsTheSafariExtension() {
        app.buttons["wallet.settings"].tap()
        let section = app.descendants(matching: .any)["settings.safariExtension"]
        if !section.waitForExistence(timeout: 3) { app.swipeUp() }
        XCTAssertTrue(section.waitForExistence(timeout: 5))
        XCTAssertTrue(section.label.contains("Safari"), section.label)
    }

    /// An app that can't load says so and offers Reload.
    func testAnUnreachableAppShowsTheErrorAndReload() {
        addApp("unreachable-byoky-ui-test.invalid", name: "Down")
        let reload = app.buttons["appRuntime.notice.reload"]
        XCTAssertTrue(reload.waitForExistence(timeout: 20), "blank screen instead of an error")
        XCTAssertTrue(app.staticTexts["unreachable-byoky-ui-test.invalid"].exists)
        reload.tap()
        XCTAssertTrue(reload.waitForExistence(timeout: 20))
        app.buttons["appRuntime.close"].tap()
    }
}

/// The Connected tab: tapping an app moves it, and its token limit and
/// Disconnect are buttons on the row, not only behind a long-press or a
/// swipe. Each test starts from a fresh wallet with one key and one
/// connected app, set up at launch.
final class ConnectedAppsUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-byokyResetOnLaunch", "-byokyUITest"]
        app.launchEnvironment["BYOKY_UITEST_CONFIG"] = """
            {"password": "CorrectHorse12!", "openaiKey": "sk-test-not-a-real-key",
             "connectedApps": ["https://chat.example.com"]}
            """
        app.launch()
        let connected = app.tabBars.buttons["Connected"]
        XCTAssertTrue(connected.waitForExistence(timeout: 10), "the wallet was not set up at launch")
        connected.tap()
    }

    private func assertTapTarget(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertGreaterThanOrEqual(element.frame.width, 44, file: file, line: line)
        XCTAssertGreaterThanOrEqual(element.frame.height, 44, file: file, line: line)
    }

    func testTappingAnAppMovesItAndItsButtonsSetALimitAndDisconnect() {
        let row = app.buttons["session.move"]
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the app's row is not a button")
        XCTAssertTrue(row.label.contains("chat.example.com"), row.label)
        row.tap()
        let defaultGroup = app.staticTexts["moveApp.group.default"]
        XCTAssertTrue(defaultGroup.waitForExistence(timeout: 5), "tapping the app did not open Move to group")
        app.navigationBars.buttons["Cancel"].tap()
        XCTAssertFalse(defaultGroup.waitForExistence(timeout: 2))

        let setLimit = app.buttons["session.setLimit"]
        XCTAssertTrue(setLimit.waitForExistence(timeout: 5))
        XCTAssertEqual(setLimit.label, "Set token limit for chat.example.com")
        assertTapTarget(setLimit)
        setLimit.tap()
        let limitForm = app.staticTexts["Total token limit"]
        XCTAssertTrue(limitForm.waitForExistence(timeout: 5), "Set limit did not open the token limit form")
        app.navigationBars.buttons["Cancel"].tap()
        XCTAssertFalse(limitForm.waitForExistence(timeout: 2))

        let disconnect = app.buttons["session.disconnect"]
        XCTAssertEqual(disconnect.label, "Disconnect chat.example.com")
        assertTapTarget(disconnect)
        disconnect.tap()
        let alert = app.alerts["Disconnect chat.example.com?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "disconnected without asking")
        alert.buttons["Cancel"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 5), "Cancel disconnected the app")

        disconnect.tap()
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        alert.buttons["Disconnect"].tap()
        XCTAssertFalse(row.waitForExistence(timeout: 2), "the app is still connected")
    }
}
