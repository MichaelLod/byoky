import SwiftUI

enum Theme {
    // Extension palette: --accent: #FF4F00
    static let accent = Color("Accent")
    static let accentSoft = Color("AccentSoft")
    static let accentHover = Color("AccentHover")

    // Extension palette: --bg: #ffffff, --bg-raised: #f8f9fa, --bg-card: #ffffff
    static let bgMain = Color("BgMain")
    static let bgRaised = Color("BgRaised")
    static let bgCard = Color("BgCard")

    // Semantic
    static let danger = Color(red: 0.957, green: 0.247, blue: 0.369) // #f43f5e
    static let success = Color(red: 0.133, green: 0.773, blue: 0.369) // #22c55e

    // Text (light theme: dark text on white)
    static let textPrimary = Color(red: 0.102, green: 0.102, blue: 0.180) // #1a1a2e
    static let textSecondary = Color(red: 0.392, green: 0.455, blue: 0.545) // #64748b
    static let textMuted = Color(red: 0.580, green: 0.639, blue: 0.722) // #94a3b8

    // Border
    static let border = Color(red: 0.886, green: 0.910, blue: 0.941) // #e2e8f0

    // Logo gradient (matches extension orange brand)
    static let logoGradient = LinearGradient(
        colors: [Color(red: 1.0, green: 0.420, blue: 0.169), Color(red: 1.0, green: 0.310, blue: 0.0)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}
