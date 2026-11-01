import Combine
import XCTest
@testable import Byoky

/// Wallet creation, lock, unlock, the brute-force lockout and auto-lock,
/// against `WalletStore.shared` and the simulator keychain. Each test creates
/// a fresh wallet and resets it afterwards, so it needs a simulator without one.
final class WalletLockTests: XCTestCase {

    private let password = "correct horse battery staple 42"

    /// Auto-lock's time, moved by hand. Its idle timer either returns from
    /// every sleep at once, as if that much time had passed, or stays asleep
    /// until cancelled.
    @MainActor
    private final class FakeClock {
        var now = Date(timeIntervalSinceReferenceDate: 0)
        /// Each sleep the idle timer asked for, in seconds.
        var sleeps: [TimeInterval] = []
        /// Runs during a sleep, at the time given (seconds from the start).
        var during: [(at: TimeInterval, run: () -> Void)] = []
        let timerWakes: Bool

        init(timerWakes: Bool) {
            self.timerWakes = timerWakes
        }

        func advance(by seconds: TimeInterval) {
            now += seconds
        }

        var clock: WalletStore.AutoLockClock {
            WalletStore.AutoLockClock(
                now: { self.now },
                sleep: { seconds in
                    self.sleeps.append(seconds)
                    guard self.timerWakes else {
                        try? await Task.sleep(for: .seconds(3600))
                        return
                    }
                    let start = self.now.timeIntervalSinceReferenceDate
                    let end = start + seconds
                    for event in self.during where event.at >= start && event.at < end {
                        self.now = Date(timeIntervalSinceReferenceDate: event.at)
                        event.run()
                    }
                    self.now = Date(timeIntervalSinceReferenceDate: end)
                }
            )
        }
    }

    @MainActor
    private func freshWallet(clock: FakeClock? = nil) throws -> WalletStore {
        let wallet = WalletStore.shared
        try XCTSkipUnless(wallet.status == .uninitialized, "needs a simulator without a wallet")
        if let clock {
            wallet.autoLockClock = clock.clock
            addTeardownBlock { @MainActor in WalletStore.shared.autoLockClock = .system }
        }
        try wallet.createPassword(password)
        addTeardownBlock { @MainActor in WalletStore.shared.resetWallet() }
        return wallet
    }

    /// Waits for the wallet to lock, with the fake clock driving the timer.
    @MainActor
    private func waitForLock(_ wallet: WalletStore) async {
        guard wallet.status != .locked else { return }
        let locked = expectation(description: "wallet locked")
        let watch = wallet.$status.first { $0 == .locked }.sink { _ in locked.fulfill() }
        await fulfillment(of: [locked], timeout: 5)
        watch.cancel()
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

    // MARK: - Auto-lock

    /// Left alone in the foreground, the wallet locks when the timeout runs out.
    @MainActor
    func testIdleTimerLocksAfterTheTimeout() async throws {
        let clock = FakeClock(timerWakes: true)
        let wallet = try freshWallet(clock: clock)
        try wallet.addCredential(providerId: "openai", label: "Work", apiKey: "sk-idle-test")
        XCTAssertEqual(wallet.status, .unlocked)

        await waitForLock(wallet)

        XCTAssertEqual(wallet.status, .locked)
        XCTAssertEqual(clock.sleeps, [wallet.autoLockTimeout])
        XCTAssertEqual(clock.now.timeIntervalSinceReferenceDate, wallet.autoLockTimeout)
        XCTAssertTrue(wallet.credentials.isEmpty)
    }

    /// Activity restarts the idle time: the timer wakes, sees the newer
    /// activity and sleeps for what is left.
    @MainActor
    func testActivityPushesTheIdleLockBack() async throws {
        let clock = FakeClock(timerWakes: true)
        clock.during = [(at: 600, run: { WalletStore.shared.noteActivity() })]
        let wallet = try freshWallet(clock: clock)

        await waitForLock(wallet)

        XCTAssertEqual(clock.sleeps, [900, 600])
        XCTAssertEqual(clock.now.timeIntervalSinceReferenceDate, 600 + wallet.autoLockTimeout)
    }

    /// Back from a short trip to the background, the wallet stays unlocked.
    @MainActor
    func testShortBackgroundStaysUnlocked() throws {
        let clock = FakeClock(timerWakes: false)
        let wallet = try freshWallet(clock: clock)

        clock.advance(by: 10)
        wallet.recordBackgroundTime()
        clock.advance(by: 600)
        wallet.checkAutoLock()

        XCTAssertEqual(wallet.status, .unlocked)
    }

    /// Longer in the background than the timeout: locked on return. The
    /// idle timer can't fire while the app is suspended.
    @MainActor
    func testLongBackgroundLocksOnReturn() throws {
        let clock = FakeClock(timerWakes: false)
        let wallet = try freshWallet(clock: clock)
        try wallet.addCredential(providerId: "openai", label: "Work", apiKey: "sk-background-test")

        clock.advance(by: 10)
        wallet.recordBackgroundTime()
        clock.advance(by: wallet.autoLockTimeout + 1)
        wallet.checkAutoLock()

        XCTAssertEqual(wallet.status, .locked)
        XCTAssertTrue(wallet.credentials.isEmpty)
    }

    /// Idle time before going to the background counts too.
    @MainActor
    func testIdleBeforeAndInTheBackgroundAddsUp() throws {
        let clock = FakeClock(timerWakes: false)
        let wallet = try freshWallet(clock: clock)

        clock.advance(by: 500)
        wallet.recordBackgroundTime()
        clock.advance(by: 401)
        wallet.checkAutoLock()

        XCTAssertEqual(wallet.status, .locked)
    }

    /// The background time is used once: a later return measures from the
    /// latest activity, not from an old trip to the background.
    @MainActor
    func testActivityAfterReturningRestartsTheIdleTime() throws {
        let clock = FakeClock(timerWakes: false)
        let wallet = try freshWallet(clock: clock)

        wallet.recordBackgroundTime()
        clock.advance(by: 800)
        wallet.checkAutoLock()
        XCTAssertEqual(wallet.status, .unlocked)

        wallet.noteActivity()
        clock.advance(by: 800)
        wallet.checkAutoLock()
        XCTAssertEqual(wallet.status, .unlocked)
    }
}
