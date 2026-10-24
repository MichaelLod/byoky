import Foundation

/// A web app the user added to the Apps tab by URL. It opens in the in-wallet
/// browser (`AppRuntimeView`), where `NativeBridgeHandler` answers the Byoky
/// SDK's connect/proxy messages with the keys in this wallet.
///
/// Entries saved by older versions carried extra registry metadata (slug,
/// author, providers, …); those keys are simply ignored when decoding.
struct InstalledApp: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    /// Normalized https URL the app opens at.
    let url: String
    /// Icon URL. Empty, or failing to load, falls back to the name's initial.
    let icon: String
    let installedAt: Date
    var enabled: Bool
}

extension InstalledApp {
    enum AddError: LocalizedError, Equatable {
        case empty
        case invalidURL
        case notHTTPS
        case duplicate

        var errorDescription: String? {
            switch self {
            case .empty: return "Enter the app's URL."
            case .invalidURL: return "That doesn't look like a valid web address."
            case .notHTTPS: return "Only https:// addresses are supported."
            case .duplicate: return "This app is already in your list."
            }
        }
    }

    /// Longest name we keep; anything longer is truncated.
    static let maxNameLength = 60

    /// Parse user input into a normalized https URL.
    ///
    /// - A bare host such as `example.com/chat` is treated as https.
    /// - Any explicit scheme other than https (http, file, javascript, …) is
    ///   rejected, as are URLs without a host and URLs carrying
    ///   `user:password@` credentials (a classic way to disguise the real host).
    /// - The scheme and host are lowercased and an empty path becomes `/`, so
    ///   the same app typed two ways is detected as a duplicate.
    static func normalizedURL(from input: String) throws -> URL {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AddError.empty }

        let lowered = trimmed.lowercased()
        if lowered.hasPrefix("http:") { throw AddError.notHTTPS }
        let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed

        guard var components = URLComponents(string: candidate),
              let scheme = components.scheme else {
            throw AddError.invalidURL
        }
        guard scheme.lowercased() == "https" else { throw AddError.notHTTPS }
        guard let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil else {
            throw AddError.invalidURL
        }

        components.scheme = "https"
        components.host = host.lowercased()
        if components.path.isEmpty { components.path = "/" }
        guard let url = components.url else { throw AddError.invalidURL }
        return url
    }

    /// The web origin (`https://host[:port]`) of an app URL. This is the
    /// identity the wallet keys sessions, groups and token limits by.
    static func origin(of url: URL) -> String {
        var origin = "https://\(url.host ?? "")"
        if let port = url.port, port != 443 { origin += ":\(port)" }
        return origin
    }

    /// Hosts where many unrelated sites share one origin. Wallet access is
    /// granted per origin, so every page there would get it.
    static let sharedHostingSuffixes = [".github.io", ".vercel.app", ".netlify.app", ".pages.dev"]
    static let sharedHostingHosts: Set<String> = ["sites.google.com"]

    static func isSharedHosting(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return sharedHostingHosts.contains(host)
            || sharedHostingSuffixes.contains { host.hasSuffix($0) || host == String($0.dropFirst()) }
    }

    /// Default display name for an app URL: its host without a leading `www.`.
    static func defaultName(for url: URL) -> String {
        var host = url.host ?? url.absoluteString
        if host.hasPrefix("www.") { host.removeFirst(4) }
        return host
    }

    /// Build a new entry from user input. `name` is optional; blank means
    /// "derive it from the URL".
    static func make(from input: String, name: String?, now: Date = Date()) throws -> InstalledApp {
        let url = try normalizedURL(from: input)
        let trimmedName = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return InstalledApp(
            id: UUID().uuidString,
            name: trimmedName.isEmpty ? defaultName(for: url) : String(trimmedName.prefix(maxNameLength)),
            url: url.absoluteString,
            // Same convention iOS Safari uses for home-screen icons; when the
            // site doesn't serve one, the grid shows the name's initial.
            icon: origin(of: url) + "/apple-touch-icon.png",
            installedAt: now,
            enabled: true
        )
    }
}
