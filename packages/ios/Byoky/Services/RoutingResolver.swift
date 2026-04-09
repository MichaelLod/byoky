import Foundation

/// Decides whether an incoming proxy request gets translated to a different
/// provider family, and if so, picks the destination credential.
///
/// This is the mobile port of `resolveCrossFamilyRoute` from
/// `packages/extension/entrypoints/background.ts:2909`. Pure logic over
/// (group, requestedProviderId, credentials). Translation feasibility checks
/// (`shouldTranslate`) are delegated to the JS bridge so the family →
/// providers mapping stays in core, not duplicated across Swift + Kotlin.
///
/// Mobile uses the default group as the global routing rule because the SDK
/// protocol doesn't yet carry per-app origin. Phase 2's data model supports
/// multiple groups for forward compat; the proxy currently only consults the
/// default.
struct RoutingResolver {
    /// Resolve the routing decision for a request.
    ///
    /// Returns `nil` (signaling "no credential available") if neither the
    /// requested provider nor any cross-family destination has a credential.
    /// Returns a decision with `translation == nil` for normal pass-through.
    /// Returns a decision with `translation != nil` for cross-family routes.
    static func resolve(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: [Credential],
        engine: TranslationEngine = .shared
    ) -> RoutingDecision? {
        // Try cross-family routing first — it wins over both gifts and direct
        // credentials when applicable, matching the extension's resolution order.
        if let cross = tryCrossFamily(
            requestedProviderId: requestedProviderId,
            requestedModel: requestedModel,
            group: group,
            credentials: credentials,
            engine: engine
        ) {
            return cross
        }

        // Direct match — credential for the provider the SDK called.
        if let cred = credentials.first(where: { $0.providerId == requestedProviderId }) {
            return RoutingDecision(credential: cred, translation: nil)
        }

        return nil
    }

    /// Cross-family resolution. Returns nil if any precondition fails.
    /// Mirrors `resolveCrossFamilyRoute` exactly.
    private static func tryCrossFamily(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: [Credential],
        engine: TranslationEngine
    ) -> RoutingDecision? {
        guard let group else { return nil }
        guard group.providerId != requestedProviderId else { return nil }
        guard let dstModel = group.model, !dstModel.isEmpty else { return nil }
        guard let srcModel = requestedModel, !srcModel.isEmpty else { return nil }

        // Family compatibility check via the JS bridge — single source of truth.
        guard engine.shouldTranslate(srcProviderId: requestedProviderId, dstProviderId: group.providerId) else {
            return nil
        }

        // Credential preference: pinned first, fallback to any credential for the destination provider.
        var resolved: Credential? = nil
        if let pinnedId = group.credentialId {
            resolved = credentials.first(where: { $0.id == pinnedId })
        }
        if resolved == nil {
            resolved = credentials.first(where: { $0.providerId == group.providerId })
        }
        guard let cred = resolved else { return nil }

        return RoutingDecision(
            credential: cred,
            translation: RoutingTranslation(
                srcProviderId: requestedProviderId,
                dstProviderId: group.providerId,
                srcModel: srcModel,
                dstModel: dstModel
            )
        )
    }

    /// Best-effort `model` extraction from a JSON request body. Returns nil
    /// for malformed bodies or when `model` is absent. Used to populate the
    /// translation context's `srcModel` field.
    static func parseModel(from body: Data?) -> String? {
        guard let body, !body.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let model = json["model"] as? String,
              !model.isEmpty else {
            return nil
        }
        return model
    }

    /// Detect whether a JSON request body asked for a streaming response.
    /// The bridge needs this to pick request vs stream translator paths.
    static func isStreamingRequest(body: Data?) -> Bool {
        guard let body,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            return false
        }
        return (json["stream"] as? Bool) == true
    }
}
