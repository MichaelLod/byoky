import SwiftUI
import UIKit.UIGestureRecognizerSubclass

struct RootView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        SwiftUI.Group {
            switch wallet.status {
            case .uninitialized:
                OnboardingView()
            case .locked:
                UnlockView()
            case .unlocked:
                MainTabView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: wallet.status == .unlocked)
        // Any touch in the app counts as activity for the idle auto-lock.
        .background(TouchActivityMonitor { wallet.noteActivity() })
        .onChange(of: scenePhase) { _, newPhase in
            PrivacyCover.shared.update(for: newPhase)
            switch newPhase {
            case .background:
                wallet.recordBackgroundTime()
            case .active:
                wallet.checkAutoLock()
            default:
                break
            }
        }
    }
}

// MARK: - Privacy cover

/// An opaque cover over the whole app while it isn't active, so the app
/// switcher's snapshot never shows a revealed password, a key being typed or
/// what an app shows in the built-in browser. A window of its own: an
/// overlay in RootView would sit under sheets and alerts.
@MainActor
final class PrivacyCover {
    static let shared = PrivacyCover()

    private var window: UIWindow?

    /// Whether the cover is up.
    var isShowing: Bool { window?.isHidden == false }

    /// Covers the app when it leaves `.active`, uncovers it on return. Not
    /// for an iPad app on a Mac, which is inactive whenever another app is
    /// in front and has no app switcher snapshot.
    func update(for phase: ScenePhase, in scene: UIWindowScene? = nil) {
        guard phase != .active else {
            window?.isHidden = true
            window = nil
            return
        }
        guard window == nil, !ProcessInfo.processInfo.isiOSAppOnMac,
              let scene = scene ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first
        else { return }
        let cover = UIWindow(windowScene: scene)
        cover.windowLevel = .alert + 1
        cover.rootViewController = UIHostingController(rootView: PrivacyCoverView())
        cover.accessibilityIdentifier = "privacyCover"
        // Shown, not made key: focus and the keyboard stay with the app.
        cover.isHidden = false
        window = cover
    }
}

private struct PrivacyCoverView: View {
    var body: some View {
        ZStack {
            ScreenBackground()
            Muninn(mood: .asleep, size: 160)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

// MARK: - Touch activity

/// Reports every touch in the window it lives in (sheets, the in-wallet
/// browser and alerts included) without taking part in gesture handling.
private struct TouchActivityMonitor: UIViewRepresentable {
    let onTouch: () -> Void

    func makeUIView(context: Context) -> WindowTouchObserverView {
        let view = WindowTouchObserverView()
        view.isUserInteractionEnabled = false
        view.onTouch = onTouch
        return view
    }

    func updateUIView(_ uiView: WindowTouchObserverView, context: Context) {
        uiView.onTouch = onTouch
    }
}

/// Puts a `TouchObservingRecognizer` on its window while it is in one.
private final class WindowTouchObserverView: UIView {
    var onTouch: () -> Void = {}
    private lazy var recognizer = TouchObservingRecognizer { [weak self] in self?.onTouch() }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        recognizer.view?.removeGestureRecognizer(recognizer)
        window?.addGestureRecognizer(recognizer)
    }
}

/// Sees each touch as it begins, then fails at once, so it never delays,
/// cancels or competes with the app's own gestures.
private final class TouchObservingRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let onTouch: () -> Void

    init(onTouch: @escaping () -> Void) {
        self.onTouch = onTouch
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        onTouch()
        state = .failed
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}
