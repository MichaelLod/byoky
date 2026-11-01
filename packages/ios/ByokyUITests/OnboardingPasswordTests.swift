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

    private func type(_ text: String, into identifier: String) {
        let field = app.secureTextFields[identifier]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(text)
    }

    private var mismatch: XCUIElement {
        app.descendants(matching: .any)["onboarding.passwordMismatch"]
    }

    func testPasswordCoreCallsTooWeakCannotCreateAWallet() {
        // Passed the old onboarding rule (12+ characters, two classes).
        type("password1234", into: "onboarding.password")
        type("password1234", into: "onboarding.confirmPassword")

        let strength = app.descendants(matching: .any)["onboarding.passwordStrength"]
        XCTAssertTrue(strength.waitForExistence(timeout: 2))
        XCTAssertTrue(strength.label.contains("Too weak"), strength.label)
        XCTAssertFalse(mismatch.exists)
        XCTAssertFalse(app.buttons["onboarding.createWallet"].isEnabled)
    }

    func testMismatchIsShownUntilThePasswordsMatch() {
        type("Correct-Horse-42x", into: "onboarding.password")
        // One character short; the field keeps focus for the last one.
        type("Correct-Horse-42", into: "onboarding.confirmPassword")

        XCTAssertTrue(mismatch.waitForExistence(timeout: 2))
        XCTAssertFalse(app.buttons["onboarding.createWallet"].isEnabled)

        app.secureTextFields["onboarding.confirmPassword"].typeText("x")

        XCTAssertFalse(mismatch.waitForExistence(timeout: 1))
        XCTAssertTrue(app.buttons["onboarding.createWallet"].isEnabled)
    }
}
