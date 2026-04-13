import SwiftUI

enum Theme {
    // Extension palette: --accent: #0ea5e9
    static let accent = Color("Accent")
    static let accentSoft = Color("AccentSoft")
    static let accentHover = Color("AccentHover")

    // Extension palette: --bg: #141418, --bg-raised: #1c1c22, --bg-card: #24242c
    static let bgMain = Color("BgMain")
    static let bgRaised = Color("BgRaised")
    static let bgCard = Color("BgCard")

    // Semantic
    static let danger = Color(red: 0.957, green: 0.247, blue: 0.369) // #f43f5e
    static let success = Color(red: 0.204, green: 0.827, blue: 0.600) // #34d399

    // Text
    static let textPrimary = Color(red: 0.961, green: 0.961, blue: 0.969) // #f5f5f7
    static let textSecondary = Color(red: 0.557, green: 0.557, blue: 0.604) // #8e8e9a
    static let textMuted = Color(red: 0.333, green: 0.333, blue: 0.373) // #55555f

    // Eyes of the owl mascot
    static let eyeCyan = Color(red: 0.490, green: 0.827, blue: 0.988) // #7dd3fc
    static let eyePupil = Color(red: 0.878, green: 0.831, blue: 1.0) // #e0d4ff

    // Logo gradient (matches extension header logo)
    static let logoGradient = LinearGradient(
        colors: [Color(red: 0.490, green: 0.827, blue: 0.988), Color(red: 0.055, green: 0.647, blue: 0.914)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}
