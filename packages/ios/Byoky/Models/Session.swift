import Foundation

struct Session: Identifiable, Codable {
    let id: String
    let appOrigin: String
    let sessionKey: String
    let providers: [String]
    let createdAt: Date
    let expiresAt: Date

    var isExpired: Bool {
        Date() > expiresAt
    }
}

struct RequestLog: Identifiable, Codable {
    let id: String
    let appOrigin: String
    let providerId: String
    let method: String
    let url: String
    let statusCode: Int
    let timestamp: Date
    var inputTokens: Int?
    var outputTokens: Int?
    var model: String?
}

struct TokenAllowance: Codable {
    let origin: String
    var totalLimit: Int?
    var providerLimits: [String: Int]?
}

struct AllowanceCheck {
    let allowed: Bool
    let reason: String?

    static func compute(allowance: TokenAllowance?, entries: [RequestLog], providerId: String) -> AllowanceCheck {
        guard let allowance else { return AllowanceCheck(allowed: true, reason: nil) }

        var totalUsed = 0
        var byProvider: [String: Int] = [:]
        for entry in entries {
            let tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0)
            totalUsed += tokens
            byProvider[entry.providerId, default: 0] += tokens
        }

        if let totalLimit = allowance.totalLimit, totalUsed >= totalLimit {
            return AllowanceCheck(allowed: false, reason: "Token allowance exceeded for \(allowance.origin)")
        }

        if let providerLimit = allowance.providerLimits?[providerId],
           (byProvider[providerId] ?? 0) >= providerLimit {
            return AllowanceCheck(allowed: false, reason: "Token allowance for \(providerId) exceeded")
        }

        return AllowanceCheck(allowed: true, reason: nil)
    }
}
