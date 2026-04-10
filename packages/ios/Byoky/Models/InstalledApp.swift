import Foundation

struct InstalledApp: Codable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let url: String
    let icon: String
    let description: String
    let category: String
    let providers: [String]
    let authorName: String
    let authorWebsite: String?
    let verified: Bool
    let installedAt: Date
    var enabled: Bool
}

struct MarketplaceApp: Codable, Identifiable {
    let id: String
    let name: String
    let slug: String
    let url: String
    let icon: String
    let description: String
    let category: String
    let providers: [String]
    let author: Author
    let status: String
    let verified: Bool
    let featured: Bool
    let createdAt: Int

    struct Author: Codable {
        let name: String
        let website: String?
    }
}

struct MarketplaceResponse: Codable {
    let apps: [MarketplaceApp]
}
