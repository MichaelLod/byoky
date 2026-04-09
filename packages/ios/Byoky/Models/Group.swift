import Foundation

/// Stable id for the always-present default group. Mirrors `DEFAULT_GROUP_ID`
/// in `packages/core/src/types.ts`. Apps with no explicit binding land here.
let defaultGroupId = "default"

/// A logical bucket that an app's requests are routed through. Binding the
/// group to (provider, credential, model) lets us reroute every app in the
/// group transparently — and, when the destination is in a different family
/// than what the app called, drives cross-family translation.
///
/// Mirrors `Group` in `packages/core/src/types.ts`. Mobile groups today are
/// global routing rules (the proxy doesn't track per-app origin), so the
/// default group is the only one consulted in the proxy path. The data model
/// supports multiple groups for forward compat with per-app routing once the
/// SDK protocol carries app identity.
struct Group: Identifiable, Codable, Equatable {
    let id: String
    var name: String
    var providerId: String
    var credentialId: String?
    var model: String?
    let createdAt: Date

    static func makeDefault(providerId: String = "anthropic", credentialId: String? = nil) -> Group {
        Group(
            id: defaultGroupId,
            name: "Default",
            providerId: providerId,
            credentialId: credentialId,
            model: nil,
            createdAt: Date()
        )
    }
}

/// `origin -> groupId` map. On mobile this is currently single-entry (the
/// hardcoded "bridge" origin maps to the default group), but the type matches
/// the extension's so storage migration is trivial when per-app routing lands.
typealias AppGroups = [String: String]

/// Cross-family routing context attached to a request when the resolver
/// decided this request needs translation. Threaded through the proxy path
/// so the JS bridge knows what to translate to and from.
///
/// Mirrors `SessionTranslation` in `packages/core/src/types.ts`. The mobile
/// version adds `srcModel` because we extract it per-request from the body
/// (the extension extracts it later in the proxy pipeline).
struct RoutingTranslation: Equatable {
    let srcProviderId: String
    let dstProviderId: String
    let srcModel: String
    let dstModel: String
}

/// Result of running RoutingResolver on a request. `translation == nil` means
/// pass-through (no translation needed); a non-nil value means rewrite the
/// upstream URL, swap credentials, and call the JS bridge.
struct RoutingDecision {
    let credential: Credential
    let translation: RoutingTranslation?

    var needsTranslation: Bool { translation != nil }
}

// MARK: - Small helpers

extension String {
    /// Returns nil if the string is empty, otherwise self. Convenient for
    /// optional fields like `Group.model` that should be `nil` rather than `""`.
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

extension Optional where Wrapped == String {
    /// Trim and convert empty to nil. Useful for cleaning up text-field input.
    var trimmedNilIfEmpty: String? {
        guard let s = self?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        return s
    }
}
