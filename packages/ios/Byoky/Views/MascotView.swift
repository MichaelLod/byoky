import SwiftUI
import UIKit

/// Muninn, Byoky's raven (docs/brand/raven.svg), drawn natively so it can
/// behave like a pet: it watches your finger, sleeps while the wallet is
/// locked, raises its crest for a connection request and nods when
/// something succeeds. Under Reduce Motion it holds still and swaps poses
/// without animating.
struct Muninn: View {
    enum Mood: Equatable {
        /// Head and eye follow touches; blinks every few seconds.
        case watching
        /// Head tucked, eye shut, "z z".
        case asleep
        /// Crest up, eye glowing, head back, looking at the request.
        case alert
    }

    var mood: Mood = .watching
    var size: CGFloat = 220
    /// Crop to the bird on a plain perch (viewBox 40 20 200 200) for small
    /// placements such as the wallet header.
    var compact = false
    /// Change this value to make Muninn nod once (~260ms).
    var nod: Int = 0

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The last touch, in window coordinates.
    @State private var touch: CGPoint?
    @State private var frameInWindow: CGRect = .zero
    @State private var blinking = false

    private var viewBox: CGRect {
        compact ? CGRect(x: 40, y: 20, width: 200, height: 200) : CGRect(x: 0, y: 0, width: 240, height: 240)
    }

    private var scale: CGFloat { size / viewBox.width }
    private var tracksTouches: Bool { mood == .watching && !reduceMotion }

    var body: some View {
        KeyframeAnimator(initialValue: 0.0, trigger: nod) { dip in
            bird(dip: dip)
        } keyframes: { _ in
            CubicKeyframe(reduceMotion ? 0 : 18, duration: 0.13)
            CubicKeyframe(0, duration: 0.13)
        }
        .frame(width: size, height: size)
        .overlay(alignment: .topTrailing) {
            if mood == .asleep { snore }
        }
        .background {
            if tracksTouches {
                TouchFollower { touch = $0 }
            }
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frameInWindow = $0 }
        .task(id: mood == .watching && !reduceMotion) {
            guard mood == .watching, !reduceMotion else { return }
            await blinkPeriodically()
        }
        .accessibilityElement()
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isImage)
    }

    // MARK: Pose

    private struct Pose: Equatable {
        /// Degrees about the head pivot (140, 96); positive tips the beak down.
        var tilt: Double = 0
        var facesLeft = false
        /// Pupil offset from (161, 62), in drawing units.
        var pupil: CGSize = .zero
    }

    private var pose: Pose {
        switch mood {
        case .asleep:
            return Pose()
        case .alert:
            return Pose(tilt: -8, pupil: CGSize(width: 2, height: 0))
        case .watching:
            guard tracksTouches, let touch, frameInWindow != .zero else { return Pose() }
            // Distances in points from the head, as on the web.
            let head = CGPoint(
                x: frameInWindow.minX + (150 - viewBox.minX) * scale,
                y: frameInWindow.minY + (70 - viewBox.minY) * scale
            )
            let dx = touch.x - head.x
            let dy = touch.y - head.y
            let facesLeft = dx < -20
            let ahead = facesLeft ? -dx : dx
            return Pose(
                tilt: Self.clamp(dy * 0.06, -16, 16),
                facesLeft: facesLeft,
                pupil: CGSize(width: Self.clamp(ahead / 40, -1, 2.6), height: Self.clamp(dy / 40, -2.4, 2.4))
            )
        }
    }

    private static func clamp(_ value: CGFloat, _ low: CGFloat, _ high: CGFloat) -> CGFloat {
        min(max(value, low), high)
    }

    private func anchor(_ x: CGFloat, _ y: CGFloat) -> UnitPoint {
        UnitPoint(x: (x - viewBox.minX) / viewBox.width, y: (y - viewBox.minY) / viewBox.height)
    }

    private func blinkPeriodically() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            blinking = true
            try? await Task.sleep(for: .milliseconds(140))
            blinking = false
        }
    }

    private var accessibilityText: String {
        switch mood {
        case .watching: return "Muninn the raven, watching"
        case .asleep: return "Muninn the raven, asleep. The wallet is locked."
        case .alert: return "Muninn the raven, on alert"
        }
    }

    // MARK: Drawing

    private func bird(dip: Double) -> some View {
        let pose = self.pose
        let asleep = mood == .asleep
        let alert = mood == .alert
        let motion: Animation? = reduceMotion ? nil : .easeOut(duration: 0.18)
        let moodChange: Animation? = reduceMotion ? nil : .easeInOut(duration: 0.4)

        return ZStack {
            if compact {
                part(.rect(60, 196.5, 160, 6), Theme.violet)
            } else {
                ForEach(Array(Raven.perch.enumerated()), id: \.offset) { _, piece in
                    part(piece, Theme.violet)
                }
            }
            ForEach(Array(Raven.body.enumerated()), id: \.offset) { _, piece in
                part(piece.shape, piece.color)
                    .opacity(piece.isHighlight && asleep ? 0.45 / 0.6 : 1)
            }

            ZStack {
                part(Raven.crestBack, Color(hex: 0x3B2D55))
                    .opacity(alert ? 1 : 0)
                part(Raven.crestFront, Color(hex: 0x4C3A6E))
                    .opacity(alert ? 1 : 0)
                ForEach(Array(Raven.head.enumerated()), id: \.offset) { _, piece in
                    part(piece.shape, piece.color)
                }
                part(.circle(160, 62, 11), Theme.violet.opacity(0.35))
                    .opacity(alert ? 1 : 0)
                part(.ellipse(160, 62, 7, 7), Theme.lilac)
                    .scaleEffect(x: 1, y: blinking ? 0.8 / 7 : 1, anchor: anchor(160, 62))
                    .opacity(asleep ? 0 : 1)
                part(.circle(161, 62, 3.4), Theme.void)
                    .offset(x: pose.pupil.width * scale, y: pose.pupil.height * scale)
                    .opacity(asleep || blinking ? 0 : 1)
                part(.rect(153, 61, 14, 2.4), Theme.phosphor)
                    .opacity(asleep ? 1 : 0)
            }
            .rotationEffect(.degrees(asleep ? 34 : pose.tilt + dip), anchor: anchor(140, 96))
            .offset(x: asleep ? -6 * scale : 0, y: asleep ? 26 * scale : 0)
        }
        .scaleEffect(x: pose.facesLeft ? -1 : 1, y: 1)
        .animation(motion, value: pose)
        .animation(moodChange, value: mood)
    }

    private func part(_ shape: RavenShape.Kind, _ color: Color) -> some View {
        RavenShape(kind: shape, viewBox: viewBox).fill(color)
    }

    /// The small phosphor "z z" beside the sleeping head.
    private var snore: some View {
        HStack(alignment: .firstTextBaseline, spacing: size * 0.01) {
            Text("z").font(.mono(max(size * 0.08, 9)))
            Text("z").font(.mono(max(size * 0.056, 7)))
        }
        .foregroundStyle(Theme.phosphor)
        .padding(.top, size * 0.07)
        .padding(.trailing, size * 0.03)
        .accessibilityHidden(true)
    }
}

// MARK: - The drawing

/// The parts of raven.svg, coordinates as in the file (viewBox 240×240).
private enum Raven {
    struct Piece {
        let shape: RavenShape.Kind
        let color: Color
        var isHighlight = false
    }

    static let perch: [RavenShape.Kind] = [
        .ring(52, 200, outer: 17.5, inner: 10.5),
        .rect(65, 196.5, 135, 7),
        .rect(172, 203, 7, 13),
        .rect(186, 203, 7, 8),
    ]

    static let body: [Piece] = [
        Piece(shape: .polygon("84,170 112,178 80,214 44,222 58,194"), color: Color(hex: 0x0E0B14)),
        Piece(shape: .polygon("84,170 96,176 58,214 44,222"), color: Color(hex: 0x1D1629)),
        Piece(shape: .rect(117, 176, 4, 21), color: Color(hex: 0x3B2D55)),
        Piece(shape: .rect(133, 174, 4, 23), color: Color(hex: 0x3B2D55)),
        Piece(shape: .polygon("108,96 130,90 152,98 166,122 162,152 142,174 112,182 84,172 70,150 84,118"), color: Color(hex: 0x0B0910)),
        Piece(shape: .polygon("152,98 166,122 162,152 146,128"), color: Color(hex: 0x17121F)),
        Piece(shape: .polygon("104,106 146,120 144,150 118,176 86,170 78,142"), color: Color(hex: 0x1A1424)),
        Piece(shape: .polygon("104,106 146,120 120,132 84,128"), color: Color(hex: 0x271D38)),
        Piece(shape: .polygon("86,150 132,138 134,142 90,156"), color: Color(hex: 0x2F2444)),
        Piece(shape: .polygon("92,164 128,154 129,158 96,169"), color: Color(hex: 0x2F2444)),
        Piece(shape: .polygon("84,118 108,96 113,100 89,123"), color: Color(hex: 0x8B5CF6).opacity(0.6), isHighlight: true),
    ]

    static let crestBack: RavenShape.Kind = .polygon("128,48 120,26 138,42")
    static let crestFront: RavenShape.Kind = .polygon("138,42 136,20 150,38")

    static let head: [Piece] = [
        Piece(shape: .polygon("126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70"), color: Color(hex: 0x0B0910)),
        Piece(shape: .polygon("148,38 170,44 160,58"), color: Color(hex: 0x231A33)),
        Piece(shape: .polygon("120,70 126,50 138,62"), color: Color(hex: 0x17121F)),
        Piece(shape: .polygon("174,56 222,74 176,84"), color: Color(hex: 0x1F1830)),
        Piece(shape: .polygon("174,56 222,74 178,70"), color: Color(hex: 0x3B2D55)),
        Piece(shape: .polygon("126,50 148,38 149,42 129,54"), color: Color(hex: 0xA78BFA).opacity(0.75)),
    ]
}

/// One primitive of the raven drawing, scaled from its viewBox to the frame.
private struct RavenShape: Shape {
    enum Kind {
        case points([CGPoint])
        case rect(CGFloat, CGFloat, CGFloat, CGFloat)
        case ellipse(CGFloat, CGFloat, CGFloat, CGFloat)
        case ring(CGFloat, CGFloat, outer: CGFloat, inner: CGFloat)

        static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Kind {
            .ellipse(cx, cy, r, r)
        }

        /// SVG `points` syntax: "x,y x,y …".
        static func polygon(_ points: String) -> Kind {
            .points(points.split(separator: " ").map { pair in
                let xy = pair.split(separator: ",").compactMap { Double($0) }
                return CGPoint(x: xy[0], y: xy[1])
            })
        }
    }

    let kind: Kind
    let viewBox: CGRect

    func path(in rect: CGRect) -> Path {
        var path = Path()
        switch kind {
        case .points(let points):
            path.addLines(points)
            path.closeSubpath()
        case .rect(let x, let y, let w, let h):
            path.addRect(CGRect(x: x, y: y, width: w, height: h))
        case .ellipse(let cx, let cy, let rx, let ry):
            path.addEllipse(in: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
        case .ring(let cx, let cy, let outer, let inner):
            path.addEllipse(in: CGRect(x: cx - outer, y: cy - outer, width: outer * 2, height: outer * 2))
            path.addEllipse(in: CGRect(x: cx - inner, y: cy - inner, width: inner * 2, height: inner * 2))
            path = path.normalized(eoFill: true)
        }
        let scale = rect.width / viewBox.width
        return path.applying(
            CGAffineTransform(translationX: rect.minX, y: rect.minY)
                .scaledBy(x: scale, y: scale)
                .translatedBy(x: -viewBox.minX, y: -viewBox.minY)
        )
    }
}

// MARK: - Following touches

/// Reports where a finger is anywhere in the window, so Muninn can look at
/// it. Lives on the window, never recognizes, and so never delays, cancels
/// or competes with buttons, lists and scroll views.
private struct TouchFollower: UIViewRepresentable {
    let onTouch: (CGPoint) -> Void

    func makeUIView(context: Context) -> TouchFollowerView {
        let view = TouchFollowerView()
        view.isUserInteractionEnabled = false
        view.onTouch = onTouch
        return view
    }

    func updateUIView(_ uiView: TouchFollowerView, context: Context) {
        uiView.onTouch = onTouch
    }

    static func dismantleUIView(_ uiView: TouchFollowerView, coordinator: ()) {
        uiView.detach()
    }
}

private final class TouchFollowerView: UIView {
    var onTouch: (CGPoint) -> Void = { _ in }
    private lazy var recognizer = TouchFollowingRecognizer { [weak self] in self?.onTouch($0) }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        detach()
        window?.addGestureRecognizer(recognizer)
    }

    func detach() {
        recognizer.view?.removeGestureRecognizer(recognizer)
    }
}

/// Sees every touch begin and move, in window coordinates, and fails once
/// the touch ends.
private final class TouchFollowingRecognizer: UIGestureRecognizer, UIGestureRecognizerDelegate {
    private let onTouch: (CGPoint) -> Void

    init(onTouch: @escaping (CGPoint) -> Void) {
        self.onTouch = onTouch
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        report(touches)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        report(touches)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        state = .failed
    }

    private func report(_ touches: Set<UITouch>) {
        guard let touch = touches.first else { return }
        onTouch(touch.location(in: nil))
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }
}

// MARK: - Provider marks

/// Renders a provider's brand mark from the asset catalog. Providers without
/// one (Ollama, LM Studio) get a mono monogram, "OL" / "LM"; an unknown
/// provider id gets a generic key glyph.
struct ProviderIcon: View {
    let providerId: String
    var size: CGFloat = 20

    var body: some View {
        if let provider = Provider.find(providerId), UIImage(named: provider.icon) != nil {
            Image(provider.icon)
                .resizable()
                .renderingMode(.template)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else if let provider = Provider.find(providerId) {
            Text(String(provider.name.prefix(2)).uppercased())
                .font(.mono(size * 0.72, weight: .medium))
                .lineLimit(1)
                .fixedSize()
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "key")
                .font(.system(size: size))
        }
    }
}
