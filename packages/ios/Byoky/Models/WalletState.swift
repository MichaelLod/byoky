import Foundation

enum WalletStatus {
    case uninitialized
    case locked
    case unlocked
}

enum BridgeStatus: Equatable {
    case inactive
    case starting
    case active(port: Int)
    case error(String)

    var isActive: Bool {
        if case .active = self { return true }
        return false
    }

    var displayText: String {
        switch self {
        case .inactive: return "Bridge inactive"
        case .starting: return "Starting bridge..."
        case .active(let port): return "Bridge active on port \(port)"
        case .error(let msg): return "Bridge error: \(msg)"
        }
    }
}
