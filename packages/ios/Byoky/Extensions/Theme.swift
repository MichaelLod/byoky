import SwiftUI

enum Theme {
    // Brand palette: --accent: #FF4F00
    static let accent = Color("Accent")
    static let accentSoft = Color("AccentSoft")
    static let accentHover = Color("AccentHover")

    // Light palette: --bg: #fafaf9, --bg-raised: #f5f5f4, --bg-card: #ffffff
    static let bgMain = Color("BgMain")
    static let bgRaised = Color("BgRaised")
    static let bgCard = Color("BgCard")

    // Semantic
    static let danger = Color(red: 0.863, green: 0.149, blue: 0.149) // #dc2626
    static let success = Color(red: 0.086, green: 0.639, blue: 0.290) // #16a34a

    // Text (warm stone)
    static let textPrimary = Color(red: 0.110, green: 0.098, blue: 0.090) // #1c1917
    static let textSecondary = Color(red: 0.341, green: 0.325, blue: 0.306) // #57534e
    static let textMuted = Color(red: 0.659, green: 0.635, blue: 0.620) // #a8a29e

    // Borders
    static let border = Color(red: 0.906, green: 0.898, blue: 0.886) // #e7e5e4
    static let borderHover = Color(red: 0.839, green: 0.827, blue: 0.816) // #d6d3d1
}
