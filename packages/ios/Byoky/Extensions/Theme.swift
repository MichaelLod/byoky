import SwiftUI
import UIKit

/// Byoky's "retro security" design (docs/brand/README.md): a black ground,
/// one violet signal colour, square edges and monospace labels. Dark only.
enum Theme {
    // Surfaces, darkest first. Elevation comes from these, not shadows.
    static let void = Color(hex: 0x07060A)        // page and screen background
    static let crypt = Color(hex: 0x100D16)       // cards, sheets, list rows
    static let ash = Color(hex: 0x17121F)         // raised and pressed surfaces
    static let ink = Color(hex: 0x0B0910)         // log blocks, the tab bar
    static let seam = Color(hex: 0x2A2236)        // borders, dividers
    static let seamStrong = Color(hex: 0x3B2D55)  // input borders, ghost buttons, icon tiles

    // Text
    static let bone = Color(hex: 0xECE8F4)  // primary
    static let fog = Color(hex: 0xA79FB8)   // secondary
    static let dim = Color(hex: 0x857C95)   // muted, mono labels

    // Signal
    static let violet = Color(hex: 0x7C3AED)       // primary buttons, focus, active tab
    static let violetHover = Color(hex: 0x8B5CF6)  // pressed primary buttons
    static let phosphor = Color(hex: 0xA78BFA)     // accent text, links, `>` prompts
    static let lilac = Color(hex: 0xC4B5FD)        // highlights on violet-soft
    static let violetSoft = violet.opacity(0.18)   // badges, selected rows
    static let focusRing = violet.opacity(0.25)    // 3pt ring around a focused input

    // Status
    static let signal = Color(hex: 0x4ADE80)  // success, unlocked
    static let amber = Color(hex: 0xFBBF24)   // warnings
    static let alarm = Color(hex: 0xF87171)   // errors, destructive actions
}

extension Color {
    /// An sRGB colour from a 0xRRGGBB literal.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

// MARK: - Type

extension Font {
    /// Chakra Petch (600 or 700): headings, buttons, the wordmark. Set it
    /// uppercase with a little tracking.
    static func display(_ size: CGFloat, weight: Font.Weight = .bold, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight == .semibold ? Theme.FontName.displaySemibold : Theme.FontName.displayBold, size: size, relativeTo: style)
    }

    /// IBM Plex Mono (400 or 500): anything machine-like — section labels,
    /// status lines, keys, origins, numbers.
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(weight == .medium ? Theme.FontName.monoMedium : Theme.FontName.monoRegular, size: size, relativeTo: style)
    }
}

extension Theme {
    /// PostScript names of the bundled fonts (see `Fonts/`, `UIAppFonts`).
    /// The system font stands in for IBM Plex Sans in body text.
    enum FontName {
        static let displaySemibold = "ChakraPetch-SemiBold"
        static let displayBold = "ChakraPetch-Bold"
        static let monoRegular = "IBMPlexMono-Regular"
        static let monoMedium = "IBMPlexMono-Medium"
    }

    private static func uiFont(_ name: String, _ size: CGFloat) -> UIFont {
        UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: .semibold)
    }

    // MARK: - UIKit chrome

    /// Styles the UIKit chrome SwiftUI modifiers don't reach: navigation and
    /// tab bars, and alerts. Call once at launch.
    static func applyAppearance() {
        let bone = UIColor(Self.bone)

        let navigation = UINavigationBarAppearance()
        navigation.configureWithOpaqueBackground()
        navigation.backgroundColor = UIColor(void)
        navigation.shadowColor = UIColor(seam)
        navigation.titleTextAttributes = [
            .foregroundColor: bone,
            .font: uiFont(FontName.displaySemibold, 17),
            .kern: 1.4,
        ]
        navigation.largeTitleTextAttributes = [
            .foregroundColor: bone,
            .font: uiFont(FontName.displayBold, 32),
            .kern: 1.2,
        ]
        let navigationBar = UINavigationBar.appearance()
        navigationBar.standardAppearance = navigation
        navigationBar.compactAppearance = navigation
        navigationBar.scrollEdgeAppearance = navigation
        navigationBar.tintColor = UIColor(phosphor)

        let tabs = UITabBarAppearance()
        tabs.configureWithOpaqueBackground()
        tabs.backgroundColor = UIColor(ink)
        tabs.shadowColor = UIColor(seam)
        for item in [tabs.stackedLayoutAppearance, tabs.inlineLayoutAppearance, tabs.compactInlineLayoutAppearance] {
            item.normal.iconColor = UIColor(dim)
            item.normal.titleTextAttributes = [.foregroundColor: UIColor(dim), .font: uiFont(FontName.monoRegular, 10), .kern: 1.0]
            item.selected.iconColor = UIColor(lilac)
            item.selected.titleTextAttributes = [.foregroundColor: UIColor(lilac), .font: uiFont(FontName.monoMedium, 10), .kern: 1.0]
        }
        let tabBar = UITabBar.appearance()
        tabBar.standardAppearance = tabs
        tabBar.scrollEdgeAppearance = tabs
        tabBar.tintColor = UIColor(lilac)
        tabBar.unselectedItemTintColor = UIColor(dim)

        UIView.appearance(whenContainedInInstancesOf: [UIAlertController.self]).tintColor = UIColor(phosphor)
    }
}
