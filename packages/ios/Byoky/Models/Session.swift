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
    let sessionId: String
    let providerId: String
    let method: String
    let url: String
    let statusCode: Int
    let timestamp: Date
    let tokensUsed: Int?
}
