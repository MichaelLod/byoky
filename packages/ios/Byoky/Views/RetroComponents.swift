import SwiftUI

// Building blocks of the retro-security design (docs/brand/README.md).

// MARK: - Backgrounds

/// The void background with its faint dot grid. Use behind full screens.
struct ScreenBackground: View {
    var body: some View {
        Theme.void
            .overlay(DotGrid())
            .ignoresSafeArea()
    }
}

/// 1pt dots of phosphor at 8% every 24pt.
struct DotGrid: View {
    var spacing: CGFloat = 24

    var body: some View {
        Canvas { context, size in
            var dots = Path()
            for x in stride(from: 1, to: size.width, by: spacing) {
                for y in stride(from: 1, to: size.height, by: spacing) {
                    dots.addRect(CGRect(x: x - 0.5, y: y - 0.5, width: 1, height: 1))
                }
            }
            context.fill(dots, with: .color(Theme.phosphor.opacity(0.08)))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// CRT scanlines for hero areas and the lock screen: a 1pt dark line every
/// 3pt. Never takes touches.
struct Scanlines: View {
    var body: some View {
        Canvas { context, size in
            var lines = Path()
            for y in stride(from: 0, to: size.height, by: 3) {
                lines.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
            }
            context.fill(lines, with: .color(.black.opacity(0.2)))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// 2pt violet L-shapes, 18pt long, on the corners of one featured panel per
/// screen at most.
struct CornerBrackets: View {
    var length: CGFloat = 18
    var lineWidth: CGFloat = 2

    var body: some View {
        Canvas { context, size in
            let w = size.width, h = size.height, l = length, t = lineWidth
            let pieces = [
                CGRect(x: 0, y: 0, width: l, height: t), CGRect(x: 0, y: 0, width: t, height: l),
                CGRect(x: w - l, y: 0, width: l, height: t), CGRect(x: w - t, y: 0, width: t, height: l),
                CGRect(x: 0, y: h - t, width: l, height: t), CGRect(x: 0, y: h - l, width: t, height: l),
                CGRect(x: w - l, y: h - t, width: l, height: t), CGRect(x: w - t, y: h - l, width: t, height: l),
            ]
            context.fill(Path { $0.addRects(pieces) }, with: .color(Theme.violet))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Voice

/// A mono status line with a prompt and a blinking cursor:
/// `> WALLET LOCKED_`. The cursor holds still under Reduce Motion.
struct PromptLine: View {
    let text: String
    var color: Color = Theme.phosphor
    var size: CGFloat = 12

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ text: String, color: Color = Theme.phosphor, size: CGFloat = 12) {
        self.text = text
        self.color = color
        self.size = size
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.6)) { timeline in
            let cursorOn = reduceMotion || Int(timeline.date.timeIntervalSinceReferenceDate / 0.6) % 2 == 0
            HStack(spacing: 0) {
                Text("> ")
                Text(text).uppercaseDisplay()
                Text("_").opacity(cursorOn ? 1 : 0)
            }
        }
        .font(.mono(size, relativeTo: .caption))
        .tracking(size * 0.16)
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

/// A status pill: a square dot and mono text, `● UNLOCKED · 3 KEYS`.
struct StatusLabel: View {
    let text: String
    var color: Color = Theme.signal

    init(_ text: String, color: Color = Theme.signal) {
        self.text = text
        self.color = color
    }

    var body: some View {
        HStack(spacing: 7) {
            Rectangle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(text)
                .uppercaseDisplay()
        }
        .font(.mono(11, relativeTo: .caption2))
        .tracking(1.5)
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
    }
}

/// An uppercase mono section label: `LAST 7 DAYS`, `REQUESTING ACCESS TO`.
struct SectionLabel: View {
    let text: String
    var color: Color = Theme.dim

    init(_ text: String, color: Color = Theme.dim) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .uppercaseDisplay()
            .font(.mono(11, weight: .medium, relativeTo: .caption))
            .tracking(1.6)
            .foregroundStyle(color)
    }
}

/// The big uppercase heading of a top-level screen, with the status line
/// above it and room for Muninn or an action on the right.
struct ScreenHeader<Trailing: View>: View {
    let title: String
    let status: String
    var statusColor: Color = Theme.signal
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .bottom, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                StatusLabel(status, color: statusColor)
                Text(title)
                    .uppercaseDisplay()
                    .font(.display(34, relativeTo: .largeTitle))
                    .tracking(1.4)
                    .foregroundStyle(Theme.bone)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .accessibilityAddTraits(.isHeader)
            }
            Spacer(minLength: 0)
            trailing()
        }
    }
}

extension ScreenHeader where Trailing == EmptyView {
    init(title: String, status: String, statusColor: Color = Theme.signal) {
        self.init(title: title, status: status, statusColor: statusColor) { EmptyView() }
    }
}

/// The logo tile: Muninn's head on a rounded black tile with a violet glow
/// (docs/brand/app-icon-small.svg, the small app icon). One of the two
/// rounded shapes in the design.
struct LogoTile: View {
    var size: CGFloat = 26

    var body: some View {
        Image("LogoTile")
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The logo tile and the `BYOKY` wordmark.
struct Wordmark: View {
    var body: some View {
        HStack(spacing: 9) {
            LogoTile()
            Text("Byoky")
                .uppercaseDisplay()
                .font(.display(18))
                .tracking(1.4)
                .foregroundStyle(Theme.bone)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Byoky")
    }
}

/// A provider's mark in a square seam-strong tile.
struct ProviderTile: View {
    let providerId: String
    var size: CGFloat = 40

    var body: some View {
        ProviderIcon(providerId: providerId, size: size * 0.45)
            .foregroundStyle(Theme.lilac)
            .frame(width: size, height: size)
            .background(Theme.ink)
            .overlay(Rectangle().strokeBorder(Theme.seamStrong, lineWidth: 1))
    }
}

// MARK: - Buttons

/// Primary (violet fill), ghost (seam-strong outline) and danger (alarm
/// outline) buttons: square, Chakra Petch, uppercase, full width.
struct RetroButtonStyle: ButtonStyle {
    enum Kind { case primary, ghost, danger }

    var kind: Kind = .primary
    var height: CGFloat = 50

    func makeBody(configuration: Configuration) -> some View {
        RetroButton(configuration: configuration, kind: kind, height: height)
    }

    private struct RetroButton: View {
        let configuration: ButtonStyleConfiguration
        let kind: Kind
        let height: CGFloat
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .uppercaseDisplay()
                .font(.display(16, weight: .semibold, relativeTo: .headline))
                .tracking(1.6)
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity, minHeight: height)
                .padding(.horizontal, 16)
                .background(background)
                .overlay(Rectangle().strokeBorder(border, lineWidth: kind == .primary ? 0 : 1))
                .contentShape(Rectangle())
                .opacity(isEnabled ? 1 : 0.4)
        }

        private var foreground: Color {
            switch kind {
            case .primary: return .white
            case .ghost: return Theme.bone
            case .danger: return Theme.alarm
            }
        }

        private var background: Color {
            let pressed = configuration.isPressed
            switch kind {
            case .primary: return pressed ? Theme.violetHover : Theme.violet
            case .ghost: return pressed ? Theme.ash : .clear
            case .danger: return pressed ? Theme.alarm.opacity(0.12) : .clear
            }
        }

        private var border: Color {
            switch kind {
            case .primary: return .clear
            case .ghost: return Theme.seamStrong
            case .danger: return Theme.alarm
            }
        }
    }
}

extension ButtonStyle where Self == RetroButtonStyle {
    static var retroPrimary: RetroButtonStyle { RetroButtonStyle(kind: .primary) }
    static var retroGhost: RetroButtonStyle { RetroButtonStyle(kind: .ghost) }
    static var retroDanger: RetroButtonStyle { RetroButtonStyle(kind: .danger) }
}

/// A bracketed mono text action, `[ BACK ]`.
struct BracketButtonStyle: ButtonStyle {
    var color: Color = Theme.phosphor

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 0) {
            Text("[ ").accessibilityHidden(true)
            configuration.label.uppercaseDisplay()
            Text(" ]").accessibilityHidden(true)
        }
        .font(.mono(12, relativeTo: .footnote))
        .tracking(1.2)
        .foregroundStyle(color)
        .opacity(configuration.isPressed ? 0.6 : 1)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

extension ButtonStyle where Self == BracketButtonStyle {
    static var bracket: BracketButtonStyle { BracketButtonStyle() }
    static func bracket(_ color: Color) -> BracketButtonStyle { BracketButtonStyle(color: color) }
}

/// A square segmented control; the selected option is filled violet.
struct RetroSegmentedPicker<Value: Hashable>: View {
    struct Option {
        let value: Value
        let title: String
        var accessibilityIdentifier: String?
    }

    let options: [Option]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button {
                    selection = option.value
                } label: {
                    Text(option.title)
                        .uppercaseDisplay()
                        .font(.mono(13, weight: .medium, relativeTo: .subheadline))
                        .tracking(0.8)
                        .foregroundStyle(selected ? .white : Theme.fog)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(selected ? Theme.violet : .clear)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier(option.accessibilityIdentifier ?? "")
            }
        }
        .background(Theme.void)
        .overlay(Rectangle().strokeBorder(Theme.seamStrong, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Fields, cards and lists

extension View {
    /// Sets text in uppercase, as headings, labels and buttons are, while
    /// VoiceOver keeps the original wording (`textCase` alone changes both).
    func uppercaseDisplay() -> some View {
        textCase(.uppercase)
            .accessibilityRepresentation { self }
    }

    /// An input box: void, 1pt seam-strong border; violet with the focus
    /// ring while focused.
    func retroField(focused: Bool = false) -> some View {
        padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.void)
            .overlay(Rectangle().strokeBorder(focused ? Theme.violet : Theme.seamStrong, lineWidth: 1))
            .padding(3)
            .overlay(Rectangle().strokeBorder(focused ? Theme.focusRing : .clear, lineWidth: 3))
            .padding(-3)
    }

    /// A card: crypt with a 1pt seam border, square corners.
    func retroCard(border: Color = Theme.seam) -> some View {
        background(Theme.crypt)
            .overlay(Rectangle().strokeBorder(border, lineWidth: 1))
    }

    /// A List or Form on the dot-grid background. Pair with `retroRow()` on
    /// its sections so every row becomes a square bordered card.
    func retroList() -> some View {
        listStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(ScreenBackground())
            .environment(\.defaultMinListRowHeight, 50)
    }

    /// Row chrome for `retroList()`: crypt card, seam border, inset from the
    /// screen edges, no separators. Apply to a Section or a single row.
    func retroRow(border: Color = Theme.seam) -> some View {
        listRowBackground(RetroRowBackground(border: border))
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 12, leading: RetroRowBackground.inset + 14, bottom: 12, trailing: RetroRowBackground.inset + 14))
    }

    /// A `retroList()` row that holds a full-width retro button: no card,
    /// just the button on the screen gutter.
    func buttonRow() -> some View {
        listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 10, leading: RetroRowBackground.inset, bottom: 10, trailing: RetroRowBackground.inset))
    }

    /// The navigation title set in Chakra Petch, uppercase. The plain title
    /// stays for VoiceOver and back buttons.
    func retroNavigationTitle(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(title)
                        .uppercaseDisplay()
                        .font(.display(17, weight: .semibold, relativeTo: .headline))
                        .tracking(1.4)
                        .foregroundStyle(Theme.bone)
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }
            }
    }
}

/// The background of one retro list row: a bordered crypt card with a
/// small gap to its neighbours.
struct RetroRowBackground: View {
    static let inset: CGFloat = 16
    var border: Color = Theme.seam

    var body: some View {
        Rectangle()
            .fill(Theme.crypt)
            .overlay(Rectangle().strokeBorder(border, lineWidth: 1))
            .padding(.horizontal, Self.inset)
            .padding(.vertical, 3)
    }
}

/// A section header for `retroList()`, aligned with the cards' edge.
struct ListHeader: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        SectionLabel(text)
            .listRowInsets(EdgeInsets(top: 18, leading: RetroRowBackground.inset, bottom: 6, trailing: RetroRowBackground.inset))
    }
}

/// A section footer for `retroList()`.
struct ListFooter<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .font(.footnote)
            .foregroundStyle(Theme.fog)
            .listRowInsets(EdgeInsets(top: 6, leading: RetroRowBackground.inset, bottom: 8, trailing: RetroRowBackground.inset))
    }
}

extension ListFooter where Content == Text {
    init(_ text: String) {
        self.content = { Text(text) }
    }
}
