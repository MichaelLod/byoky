import Foundation
import Security

struct Gift: Identifiable, Codable {
    let id: String
    let credentialId: String
    let providerId: String
    let label: String
    let authToken: String
    let maxTokens: Int
    var usedTokens: Int
    let expiresAt: Date
    let createdAt: Date
    var active: Bool
    let relayUrl: String
    /// Opt-in flag — true if the gift is listed on /token-pool.
    var listed: Bool?
    /// Free-form description shown under the gifter's username on the
    /// public pool card.
    var description: String?
    /// Short-link id for pool redemption.
    var giftShortId: String?
}

struct GiftLink: Codable {
    let v: Int
    let id: String
    let p: String
    let n: String
    let s: String
    let t: String
    let m: Int
    let e: TimeInterval
    let r: String
}

struct GiftedCredential: Identifiable, Codable {
    let id: String
    let giftId: String
    let providerId: String
    let providerName: String
    let senderLabel: String
    let authToken: String
    let maxTokens: Int
    var usedTokens: Int
    let expiresAt: Date
    let relayUrl: String
    let createdAt: Date
}

// MARK: - Encoding / Decoding

func encodeGiftLink(_ link: GiftLink) -> String {
    guard let data = try? JSONEncoder().encode(link) else { return "" }
    return base64urlEncode(data)
}

func decodeGiftLink(_ encoded: String) throws -> GiftLink {
    guard let data = base64urlDecode(encoded) else {
        throw GiftError.invalidEncoding
    }
    return try JSONDecoder().decode(GiftLink.self, from: data)
}

func giftLinkToUrl(_ encoded: String) -> String {
    "https://byoky.com/gift/\(encoded)"
}

func giftShortLinkToUrl(_ shortId: String) -> String {
    "https://byoky.com/g/\(shortId)"
}

/// Extract a short id from a pasted https://byoky.com/g/<id> or byoky://g/<id>
/// URL, or return the input itself if it already looks like a bare short id.
/// Returns nil for anything that isn't a short-link shape.
func extractGiftShortId(from input: String) -> String? {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let shortIdPattern = #"^[A-Za-z0-9]{8,32}$"#

    for prefix in ["https://byoky.com/g/", "http://byoky.com/g/", "byoky://g/"] {
        if trimmed.hasPrefix(prefix) {
            let id = String(trimmed.dropFirst(prefix.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            return id.range(of: shortIdPattern, options: .regularExpression) != nil ? id : nil
        }
    }
    return trimmed.range(of: shortIdPattern, options: .regularExpression) != nil ? trimmed : nil
}

func validateGiftLink(_ link: GiftLink) throws {
    guard link.v == 1 else { throw GiftError.unsupportedVersion }
    guard !link.id.isEmpty else { throw GiftError.missingField("id") }
    guard !link.p.isEmpty else { throw GiftError.missingField("provider") }
    guard !link.t.isEmpty else { throw GiftError.missingField("token") }
    guard link.m > 0 else { throw GiftError.invalidBudget }
    guard !link.r.isEmpty else { throw GiftError.missingField("relay") }

    let expiresAt = Date(timeIntervalSince1970: link.e / 1000)
    guard expiresAt > Date() else { throw GiftError.expired }
}

func isGiftExpired(_ gift: Gift) -> Bool {
    !gift.active || Date() > gift.expiresAt
}

func giftBudgetRemaining(_ gift: Gift) -> Int {
    max(0, gift.maxTokens - gift.usedTokens)
}

func giftBudgetPercent(_ gift: Gift) -> Double {
    guard gift.maxTokens > 0 else { return 0 }
    return Double(gift.usedTokens) / Double(gift.maxTokens)
}

func isGiftedCredentialExpired(_ credential: GiftedCredential) -> Bool {
    Date() > credential.expiresAt
}

func giftedBudgetRemaining(_ credential: GiftedCredential) -> Int {
    max(0, credential.maxTokens - credential.usedTokens)
}

func giftedBudgetPercent(_ credential: GiftedCredential) -> Double {
    guard credential.maxTokens > 0 else { return 0 }
    return Double(credential.usedTokens) / Double(credential.maxTokens)
}

func createGiftLink(from gift: Gift) -> (encoded: String, link: GiftLink) {
    let provider = Provider.find(gift.providerId)
    let link = GiftLink(
        v: 1,
        id: gift.id,
        p: gift.providerId,
        n: provider?.name ?? gift.providerId,
        s: gift.label,
        t: gift.authToken,
        m: gift.maxTokens,
        e: gift.expiresAt.timeIntervalSince1970 * 1000,
        r: gift.relayUrl
    )
    return (encodeGiftLink(link), link)
}

// MARK: - Base64url

private func base64urlEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private func base64urlDecode(_ string: String) -> Data? {
    var base64 = string
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder > 0 {
        base64 += String(repeating: "=", count: 4 - remainder)
    }
    return Data(base64Encoded: base64)
}

// MARK: - Secure Random Token

func generateSecureToken(byteCount: Int = 32) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
}

// MARK: - Errors

enum GiftError: LocalizedError {
    case invalidEncoding
    case unsupportedVersion
    case missingField(String)
    case invalidBudget
    case expired
    case alreadyRedeemed

    var errorDescription: String? {
        switch self {
        case .invalidEncoding: return "Invalid gift link encoding"
        case .unsupportedVersion: return "Unsupported gift link version"
        case .missingField(let field): return "Missing required field: \(field)"
        case .invalidBudget: return "Invalid token budget"
        case .expired: return "This gift has expired"
        case .alreadyRedeemed: return "This gift has already been redeemed"
        }
    }
}
