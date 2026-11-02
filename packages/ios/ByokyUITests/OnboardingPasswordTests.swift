import XCTest

/// Onboarding's password step: the master-password rule is the extension's
/// (core checkPasswordStrength, score 2 or more), and a mismatch is spelled
/// out instead of leaving Create Wallet disabled without a reason.
final class OnboardingPasswordTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // A fresh wallet; no -byokyUITest, so no auto-setup skips onboarding.
        app.launchArguments = ["-byokyResetOnLaunch"]
        app.launch()

        let getStarted = app.buttons["onboarding.getStarted"]
        XCTAssertTrue(getStarted.waitForExistence(timeout: 10))
        getStarted.tap()
    }

    /// Both fields the way they're typed on a smaller phone, where the
    /// keyboard covers Confirm: Return in the first field moves on to it.
    private func typePasswords(_ password: String, confirm: String) {
        let field = app.secureTextFields["onboarding.password"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(password + "\n")
        app.secureTextFields["onboarding.confirmPassword"].typeText(confirm)
    }

    private var mismatch: XCUIElement {
        app.descendants(matching: .any)["onboarding.passwordMismatch"]
    }

    func testPasswordCoreCallsTooWeakCannotCreateAWallet() {
        // Passed the old onboarding rule (12+ characters, two classes).
        typePasswords("password1234", confirm: "password1234")

        let strength = app.descendants(matching: .any)["onboarding.passwordStrength"]
        XCTAssertTrue(strength.waitForExistence(timeout: 2))
        XCTAssertTrue(strength.label.contains("Too weak"), strength.label)
        XCTAssertFalse(mismatch.exists)
        XCTAssertFalse(app.buttons["onboarding.createWallet"].isEnabled)
    }

    func testMismatchIsShownUntilThePasswordsMatch() {
        // One character short; the field keeps focus for the last one.
        typePasswords("Correct-Horse-42x", confirm: "Correct-Horse-42")

        XCTAssertTrue(mismatch.waitForExistence(timeout: 2))
        XCTAssertFalse(app.buttons["onboarding.createWallet"].isEnabled)

        app.secureTextFields["onboarding.confirmPassword"].typeText("x")

        XCTAssertFalse(mismatch.waitForExistence(timeout: 1))
        XCTAssertTrue(app.buttons["onboarding.createWallet"].isEnabled)
    }

    /// Return in Confirm creates the wallet once the passwords are valid,
    /// so the keyboard covering Create Wallet blocks nothing.
    func testReturnCreatesTheWalletOnceThePasswordsMatch() {
        typePasswords("Correct-Horse-42x", confirm: "Correct-Horse-42x\n")
        XCTAssertTrue(app.buttons["wallet.settings"].waitForExistence(timeout: 30))
    }
}
