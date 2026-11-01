import XCTest
@testable import Byoky

/// Wallet creation, lock, unlock and the brute-force lockout, against
/// `WalletStore.shared` and the simulator keychain. Each test creates a fresh
/// wallet and resets it afterwards, so it needs a simulator without one.
final class WalletLockTests: XCTestCase {

    private let password = "correct horse battery staple 42"

    @MainActor
    private func freshWallet() throws -> WalletStore {
        let wallet = WalletStore.shared
        try XCTSkipUnless(wallet.status == .uninitialized, "needs a simulator without a wallet")
        try wallet.createPassword(password)
        addTeardownBlock { @MainActor in WalletStore.shared.resetWallet() }
        return wallet
    }

    @MainActor
    func testLockForgetsKeysAndUnlockBringsThemBack() throws {
        let wallet = try freshWallet()
        XCTAssertEqual(wallet.status, .unlocked)
        try wallet.addCredential(providerId: "openai", label: "Work", apiKey: "sk-lock-test-1")

        wallet.lock()
        XCTAssertEqual(wallet.status, .locked)
        XCTAssertTrue(wallet.credentials.isEmpty)
        XCTAssertThrowsError(try wallet.addCredential(providerId: "openai", label: "x", apiKey: "sk-x"))

        XCTAssertThrowsError(try wallet.unlock(password: "wrong password")) { error in
            guard case WalletError.wrongPassword = error else { return XCTFail("\(error)") }
        }
        XCTAssertEqual(wallet.status, .locked)

        try wallet.unlock(password: password)
        XCTAssertEqual(wallet.status, .unlocked)
        let credential = try XCTUnwrap(wallet.credentials.first)
        XCTAssertEqual(try wallet.decryptKey(for: credential), "sk-lock-test-1")
    }

    /// Five wrong passwords lock the wallet out; while it lasts even the
    /// right password is refused.
    @MainActor
    func testRepeatedWrongPasswordsLockOut() throws {
        let wallet = try freshWallet()
        wallet.lock()

        for attempt in 1...4 {
            XCTAssertThrowsError(try wallet.unlock(password: "guess \(attempt)"))
            XCTAssertNil(wallet.lockoutEndTime, "no lockout after \(attempt) attempts")
        }
        XCTAssertThrowsError(try wallet.unlock(password: "guess 5"))
        let until = try XCTUnwrap(wallet.lockoutEndTime)
        XCTAssertEqual(until.timeIntervalSinceNow, 30, accuracy: 5)

        XCTAssertThrowsError(try wallet.unlock(password: password)) { error in
            guard case WalletError.lockedOut = error else { return XCTFail("\(error)") }
        }
        XCTAssertEqual(wallet.status, .locked)
    }

    @MainActor
    func testResetClearsTheWalletAndTheLockout() throws {
        let wallet = try freshWallet()
        try wallet.addCredential(providerId: "openai", label: "Work", apiKey: "sk-reset-test")
        wallet.lock()
        XCTAssertThrowsError(try wallet.unlock(password: "nope"))

        wallet.resetWallet()

        XCTAssertEqual(wallet.status, .uninitialized)
        XCTAssertNil(wallet.lockoutEndTime)
        try wallet.createPassword(password)
        XCTAssertTrue(wallet.credentials.isEmpty)
    }
}
