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
    /// Resolution order (matches the extension's background.ts):
    ///   1. Cross-family translation (group binds to a different family)
    ///   2. Same-family swap (group binds to a different openai-family
    ///      provider with the same wire format)
    ///   3. Direct credential for the provider the SDK called
    ///
    /// Returns `nil` (signaling "no credential available") only when none of
    /// the above yields a usable credential.
    static func resolve(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: [Credential],
        engine: TranslationEngine = .shared
    ) -> RoutingDecision? {
        // 1. Cross-family translation.
        if let cross = tryCrossFamily(
            requestedProviderId: requestedProviderId,
            requestedModel: requestedModel,
            group: group,
            credentials: credentials,
            engine: engine
        ) {
            return cross
        }

        // 2. Same-family swap.
        if let swap = trySameFamilySwap(
            requestedProviderId: requestedProviderId,
            group: group,
            credentials: credentials,
            engine: engine
        ) {
            return swap
        }

        // 3. Direct credential match. When the group also pins a model for
        // this provider, surface it so the proxy rewrites the body — the
        // group is the strongest routing force, stronger than the SDK's
        // model choice.
        if let cred = credentials.first(where: { $0.providerId == requestedProviderId }) {
            let override: String? = (group?.providerId == requestedProviderId)
                ? group?.model?.nilIfEmpty
                : nil
            return RoutingDecision(credential: cred, translation: nil, modelOverride: override)
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

        // Pin enforcement: when a pin is set we honor it strictly. A stale
        // pin returns nil rather than silently swapping to a different
        // credential of the same provider — that would mask the user's
        // cost-attribution intent.
        let resolved: Credential?
        if let pinnedId = group.credentialId {
            resolved = credentials.first(where: { $0.id == pinnedId })
        } else {
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

    /// Same-family swap resolution. Two providers in the same family (e.g.
    /// Groq and OpenAI, both in the openai family) speak identical wire
    /// protocols, so "routing" collapses to: swap credentials, rewrite the
    /// destination URL, and optionally override the body's model field.
    ///
    /// Preconditions (all must hold):
    ///   - a group exists
    ///   - the group targets a *different* provider than what the SDK called
    ///   - both providers are in the same family (per the JS bridge)
    ///   - a credential is available for the destination
    ///
    /// Notably, `group.model` is *not* required here — a swap works even
    /// when the group has no model pinned (we just forward the SDK's model).
    /// If the group does pin a model, we pass it along as `swapDstModel`
    /// so the caller can substitute it into the request body.
    private static func trySameFamilySwap(
        requestedProviderId: String,
        group: Group?,
        credentials: [Credential],
        engine: TranslationEngine
    ) -> RoutingDecision? {
        guard let group else { return nil }
        guard group.providerId != requestedProviderId else { return nil }

        // Must be same family AND not a no-op (different provider id).
        guard engine.sameFamily(srcProviderId: requestedProviderId, dstProviderId: group.providerId) else {
            return nil
        }

        // Strict pin enforcement: stale pin → nil, no silent fallback to a
        // different credential of the destination provider.
        let resolved: Credential?
        if let pinnedId = group.credentialId {
            resolved = credentials.first(where: { $0.id == pinnedId })
        } else {
            resolved = credentials.first(where: { $0.providerId == group.providerId })
        }
        guard let cred = resolved else { return nil }

        return RoutingDecision(
            credential: cred,
            swapToProviderId: group.providerId,
            swapDstModel: group.model?.nilIfEmpty
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
