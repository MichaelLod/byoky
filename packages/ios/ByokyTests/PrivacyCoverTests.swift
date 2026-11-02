import SwiftUI
import XCTest
@testable import Byoky

/// The app switcher's snapshot shows the privacy cover, never the wallet:
/// it goes up as soon as the app stops being active, above everything
/// (sheets and alerts included), and comes down on return.
final class PrivacyCoverTests: XCTestCase {

    @MainActor
    private func scene() throws -> UIWindowScene {
        try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    }

    @MainActor
    private func coverWindow(in scene: UIWindowScene) -> UIWindow? {
        scene.windows.first { $0.accessibilityIdentifier == "privacyCover" && !$0.isHidden }
    }

    @MainActor
    func testCoversTheAppWhileItIsNotActive() throws {
        let scene = try scene()
        let cover = PrivacyCover.shared
        addTeardownBlock { @MainActor in PrivacyCover.shared.update(for: .active) }

        cover.update(for: .inactive, in: scene)
        XCTAssertTrue(cover.isShowing)
        let window = try XCTUnwrap(coverWindow(in: scene))
        XCTAssertGreaterThan(window.windowLevel, .alert, "it must cover sheets and alerts too")
        XCTAssertFalse(window.isKeyWindow, "the app keeps focus and its keyboard")

        // Still the one cover once the app reaches the background.
        cover.update(for: .background, in: scene)
        XCTAssertEqual(scene.windows.filter { $0.accessibilityIdentifier == "privacyCover" && !$0.isHidden }.count, 1)

        cover.update(for: .active, in: scene)
        XCTAssertFalse(cover.isShowing)
        XCTAssertNil(coverWindow(in: scene))
    }
}
