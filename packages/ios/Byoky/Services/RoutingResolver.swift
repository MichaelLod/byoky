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
    ///   4. Auto cross-family translation — opportunistic fallback when the
    ///      user holds credentials only in other families and the app has no
    ///      group binding. Skipped when a group is set (group intent wins).
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
        // model choice. A group bound to this provider with a pinned key
        // uses exactly that key; a stale pin resolves to nothing rather than
        // silently spending another key (core's resolveRoute does the same).
        let override: String? = (group?.providerId == requestedProviderId)
            ? group?.model?.nilIfEmpty
            : nil
        if let group, group.providerId == requestedProviderId, let pinnedId = group.credentialId {
            guard let pinned = credentials.first(where: { $0.id == pinnedId }) else { return nil }
            return RoutingDecision(credential: pinned, translation: nil, modelOverride: override)
        }
        if let cred = credentials.first(where: { $0.providerId == requestedProviderId }) {
            return RoutingDecision(credential: cred, translation: nil, modelOverride: override)
        }

        // 4. Auto cross-family translation. Fires only when the app has no
        //    explicit group binding — the default sentinel group (empty
        //    providerId) counts as "no binding" because the user hasn't
        //    expressed routing intent. When the user HAS set a group, we
        //    never silently route around it; returning nil here surfaces
        //    NO_CREDENTIAL so the stale config gets noticed.
        let hasExplicitGroup = (group?.providerId.isEmpty == false)
        if !hasExplicitGroup {
            if let auto = tryAutoCrossFamily(
                requestedProviderId: requestedProviderId,
                requestedModel: requestedModel,
                credentials: credentials,
                engine: engine
            ) {
                return auto
            }
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

    /// Auto cross-family fallback — mirrors `resolveAutoCrossFamilyRoute` in
    /// `packages/core/src/routing.ts`. Picks a translatable credential from
    /// the user's wallet when the app asks for a provider they don't hold.
    ///
    /// Candidate ordering (`Credential` on iOS has no `lastUsedAt` yet, so MRU
    /// degrades to family order + createdAt):
    ///   1. Family preference: anthropic > openai > gemini > cohere > other
    ///   2. Tiebreak by `createdAt` desc (newest credential first)
    ///
    /// Uses `defaultModelFor(family:)` to pick the family flagship as the
    /// destination model. The `srcModel` field of RoutingTranslation is
    /// populated from the inbound request body when available.
    private static func tryAutoCrossFamily(
        requestedProviderId: String,
        requestedModel: String?,
        credentials: [Credential],
        engine: TranslationEngine
    ) -> RoutingDecision? {
        // Defensive: if the user already holds the requested provider, the
        // direct-match branch above already took it and we never run. But
        // guard just in case callers invoke this method directly.
        if credentials.contains(where: { $0.providerId == requestedProviderId }) {
            return nil
        }

        // A future createdAt (e.g. from a hand-edited backup) must not let a
        // credential jump the queue: treat it as "now".
        let now = Date()
        let sorted = credentials.sorted { a, b in
            let ao = familyOrder(for: a.providerId)
            let bo = familyOrder(for: b.providerId)
            if ao != bo { return ao < bo }
            return min(a.createdAt, now) > min(b.createdAt, now)
        }

        guard let srcModel = requestedModel, !srcModel.isEmpty else {
            // Translation needs a source model to build the outbound body.
            // The extension extracts it from the request body earlier in the
            // proxy pipeline; on mobile, missing srcModel → skip auto-route
            // and surface NO_CREDENTIAL so the user notices.
            return nil
        }

        for cred in sorted {
            guard engine.shouldTranslate(srcProviderId: requestedProviderId, dstProviderId: cred.providerId) else {
                continue
            }
            guard let dstModel = defaultFlagshipModel(for: cred.providerId) else { continue }
            return RoutingDecision(
                credential: cred,
                translation: RoutingTranslation(
                    srcProviderId: requestedProviderId,
                    dstProviderId: cred.providerId,
                    srcModel: srcModel,
                    dstModel: dstModel
                )
            )
        }

        return nil
    }

    /// Family preference index for tiebreaking auto cross-family candidate
    /// ordering. Mirrors `FAMILY_ORDER` in routing.ts — keep these in lockstep.
    private static func familyOrder(for providerId: String) -> Int {
        switch providerId {
        case "anthropic": return 0
        case "openai", "azure_openai", "groq", "together", "deepseek",
             "xai", "perplexity", "fireworks", "openrouter", "mistral":
            return 1
        case "gemini": return 2
        case "cohere": return 3
        default: return 99
        }
    }

    /// Flagship model id for the family containing `providerId`. Mirrors
    /// `DEFAULT_MODELS` in `packages/core/src/models.ts` — keep in sync
    /// whenever that map changes.
    private static func defaultFlagshipModel(for providerId: String) -> String? {
        switch providerId {
        case "anthropic":
            return "claude-sonnet-4-6"
        case "openai", "azure_openai", "groq", "together", "deepseek",
             "xai", "perplexity", "fireworks", "openrouter", "mistral":
            return "gpt-5.4"
        case "gemini":
            return "gemini-2.5-pro"
        case "cohere":
            return "command-a-03-2025"
        default:
            return nil
        }
    }

    /// Human-readable message for a NO_CREDENTIAL proxy error. Three cases:
    ///   1. The app's group routes to a provider the user has no key for.
    ///   2. The user has keys, just not for the requested provider.
    ///   3. The wallet holds no keys at all.
    static func noCredentialMessage(
        requestedProviderId: String,
        userCredentialProviderIds: [String],
        group: Group?
    ) -> String {
        let req = requestedProviderId
        // An empty providerId means the sentinel default group — no routing,
        // so treat as if no group were set.
        if let groupBinding = group?.providerId.nilIfEmpty, groupBinding != req {
            return "No \(groupBinding) API key found. Add a \(groupBinding) key to your wallet, or assign this app to a provider you already have a key for."
        }
        if !userCredentialProviderIds.isEmpty {
            return "No \(req) API key found. Keys: \(userCredentialProviderIds.joined(separator: ", ")). Add a \(req) key, or assign this app to one of those providers."
        }
        return "No API keys in your wallet. Add a key for any provider to get started."
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

    /// The model a request is for: the body's `model`, or for Gemini, which
    /// names it in the path (`/v1beta/models/{model}:generateContent`), the
    /// URL.
    static func requestedModel(body: Data?, url: String, providerId: String) -> String? {
        if let model = parseModel(from: body) { return model }
        guard providerId == "gemini" else { return nil }
        return geminiModel(fromURL: url)
    }

    /// `{model}` from a Gemini `…/models/{model}:{action}` URL.
    static func geminiModel(fromURL url: String) -> String? {
        guard let path = URLComponents(string: url)?.path else { return nil }
        let segments = path.split(separator: "/")
        guard segments.count >= 2, segments[segments.count - 2] == "models",
              let colon = segments[segments.count - 1].lastIndex(of: ":") else { return nil }
        let model = segments[segments.count - 1][..<colon]
        return model.isEmpty ? nil : String(model)
    }

    /// Detect whether a request asked for a streaming response. The bridge
    /// needs this to pick request vs stream translator paths. Gemini says so
    /// in the URL (`:streamGenerateContent`, `?alt=sse`), the other dialects
    /// with `"stream": true` in the body.
    static func isStreamingRequest(body: Data?, url: String? = nil) -> Bool {
        if let url, let path = URLComponents(string: url)?.path,
           path.hasSuffix(":streamGenerateContent") {
            return true
        }
        guard let body,
              let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            return false
        }
        return (json["stream"] as? Bool) == true
    }
}
