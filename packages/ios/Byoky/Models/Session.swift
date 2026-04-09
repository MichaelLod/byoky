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
    /// When cross-family routing translated this request, the upstream provider
    /// it was actually sent to (differs from `providerId`, which is the family
    /// the app called). Nil for pass-through requests.
    var actualProviderId: String?
    /// The destination model used after translation. Nil for pass-through.
    var actualModel: String?
    /// The routing group that resolved this request. Nil for pass-through or
    /// when the app wasn't bound to a group.
    var groupId: String?
    /// Advanced capabilities the request body used (tools, vision, etc.).
    /// Populated by `detectRequestCapabilities` at log time so the Apps screen
    /// can warn before moving an app to a group whose model lacks one of them.
    var usedCapabilities: CapabilitySet?
}

/// Capability flags a single request used. Mirrors `CapabilitySet` in
/// `packages/core/src/types.ts`. Walked across an app's recent requests by
/// `detectAppCapabilities` to produce a per-app union, which the Apps screen
/// diffs against a candidate destination model via `capabilityGaps`.
struct CapabilitySet: Codable, Equatable {
    var tools: Bool
    var vision: Bool
    var structuredOutput: Bool
    var reasoning: Bool

    static let empty = CapabilitySet(tools: false, vision: false, structuredOutput: false, reasoning: false)
}

/// OR-merge an app's per-request capability fingerprints into a single union
/// describing everything it has ever needed. Mirrors `detectAppCapabilities`
/// in `packages/core/src/models.ts`.
func detectAppCapabilities(_ entries: [RequestLog]) -> CapabilitySet {
    var out = CapabilitySet.empty
    for e in entries {
        guard let used = e.usedCapabilities else { continue }
        if used.tools { out.tools = true }
        if used.vision { out.vision = true }
        if used.structuredOutput { out.structuredOutput = true }
        if used.reasoning { out.reasoning = true }
    }
    return out
}

/// Diff a set of capabilities the app has used against a destination model's
/// `capabilities` map (decoded from the JS bridge `describeModel` JSON).
/// Returns the subset of keys the model lacks. Empty array means the model
/// satisfies everything the app has needed so far. Mirrors `capabilityGaps`
/// in `packages/core/src/models.ts`.
func capabilityGaps(used: CapabilitySet, modelCapabilities caps: [String: Bool]) -> [String] {
    var gaps: [String] = []
    if used.tools && caps["tools"] != true { gaps.append("tools") }
    if used.vision && caps["vision"] != true { gaps.append("vision") }
    if used.structuredOutput && caps["structuredOutput"] != true { gaps.append("structuredOutput") }
    if used.reasoning && caps["reasoning"] != true { gaps.append("reasoning") }
    return gaps
}

/// Human label for a capability key. Used in warning messages. Mirrors
/// `capabilityLabel` in `packages/core/src/models.ts`.
func capabilityLabel(_ key: String) -> String {
    switch key {
    case "tools": return "tool calling"
    case "vision": return "image inputs"
    case "structuredOutput": return "structured outputs"
    case "reasoning": return "extended reasoning"
    default: return key
    }
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
