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
