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
    /// The session the request ran in, for `session.getUsage()`. Nil for
    /// entries logged before it was recorded.
    var sessionId: String?
}

/// What `session.getUsage()` reports: a session's successful requests and
/// their tokens, in total and per provider. Mirrors `getSessionUsage` in the
/// extension's background script and `SessionUsage` in core.
struct SessionUsage: Equatable {
    struct Totals: Equatable {
        var requests = 0
        var inputTokens = 0
        var outputTokens = 0

        mutating func add(inputTokens input: Int, outputTokens output: Int) {
            requests += 1
            inputTokens += input
            outputTokens += output
        }

        var payload: [String: Int] {
            ["requests": requests, "inputTokens": inputTokens, "outputTokens": outputTokens]
        }
    }

    private(set) var total = Totals()
    private(set) var byProvider: [String: Totals] = [:]

    init(sessionId: String, logs: [RequestLog]) {
        for entry in logs where entry.sessionId == sessionId && entry.statusCode < 400 {
            let input = entry.inputTokens ?? 0
            let output = entry.outputTokens ?? 0
            total.add(inputTokens: input, outputTokens: output)
            byProvider[entry.providerId, default: Totals()].add(inputTokens: input, outputTokens: output)
        }
    }

    /// The SDK's shape: `{ requests, inputTokens, outputTokens, byProvider }`.
    var payload: [String: Any] {
        var payload: [String: Any] = total.payload
        payload["byProvider"] = byProvider.mapValues(\.payload)
        return payload
    }
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

    /// `totalUsed` and `providerUsed` include tokens held by requests still
    /// in flight. Mirrors `computeAllowanceCheck` in core proxy-utils.ts.
    static func compute(allowance: TokenAllowance?, totalUsed: Int, providerUsed: Int, providerId: String) -> AllowanceCheck {
        guard let allowance else { return AllowanceCheck(allowed: true, reason: nil) }

        if let totalLimit = allowance.totalLimit, totalUsed >= totalLimit {
            return AllowanceCheck(allowed: false, reason: "Token allowance exceeded for \(allowance.origin)")
        }

        if let providerLimit = allowance.providerLimits?[providerId], providerUsed >= providerLimit {
            return AllowanceCheck(allowed: false, reason: "Token allowance for \(providerId) exceeded")
        }

        return AllowanceCheck(allowed: true, reason: nil)
    }
}

/// Tokens each app has used, per provider, counted against its allowance.
/// Unlike the request log, which keeps only the latest 500 entries, it never
/// drops anything, so an app can't outrun its limit by sheer request count.
struct TokenUsageLedger: Codable, Equatable {
    /// origin → providerId → tokens
    private(set) var tokens: [String: [String: Int]] = [:]

    func total(origin: String) -> Int {
        tokens[origin]?.values.reduce(0, +) ?? 0
    }

    func used(origin: String, providerId: String) -> Int {
        tokens[origin]?[providerId] ?? 0
    }

    mutating func add(_ count: Int, origin: String, providerId: String) {
        guard count > 0 else { return }
        tokens[origin, default: [:]][providerId, default: 0] += count
    }

    /// Usage recorded before the ledger existed: the successful requests
    /// still in the log.
    static func seeded(from logs: [RequestLog]) -> TokenUsageLedger {
        var ledger = TokenUsageLedger()
        for entry in logs where entry.statusCode < 400 {
            ledger.add((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0), origin: entry.appOrigin, providerId: entry.providerId)
        }
        return ledger
    }
}

/// Tokens held against an app's allowance while one of its requests runs.
/// Settled with the real count when the request ends.
struct TokenReservation: Hashable {
    let id = UUID()
    let origin: String
    let providerId: String
    let tokens: Int
}

struct AllowanceExceeded: Error {
    let reason: String
}
