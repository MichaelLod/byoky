import XCTest

/// Smoke test — proves the XCUITest target boots and the Byoky app launches
/// to the welcome screen. This is deliberately minimal. The real cross-device
/// flow (wallet create → credentials → groups → gift → redeem) lives in
/// ByokyLiveFlowTests, which is driven from the node/Playwright harness
/// that coordinates the desktop extension wallet on the other side.
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
