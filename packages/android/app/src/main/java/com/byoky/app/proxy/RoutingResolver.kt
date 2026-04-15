package com.byoky.app.proxy

import com.byoky.app.data.Credential
import com.byoky.app.data.Group
import com.byoky.app.data.RoutingDecision
import com.byoky.app.data.RoutingTranslation
import org.json.JSONObject

/**
 * Decides whether an incoming proxy request gets translated to a different
 * provider family, and if so, picks the destination credential.
 *
 * Mobile port of `resolveCrossFamilyRoute` from
 * `packages/extension/entrypoints/background.ts:2909`. Pure logic over
 * (group, requestedProviderId, credentials). Translation feasibility checks
 * (`shouldTranslate`) are delegated to the JS bridge so the family →
 * providers mapping stays in core, not duplicated across Swift + Kotlin.
 *
 * Mobile uses the default group as the global routing rule because the SDK
 * protocol doesn't yet carry per-app origin. Phase 2's data model supports
 * multiple groups for forward compat; the proxy currently only consults the
 * default.
 */
object RoutingResolver {

    /**
     * Resolve the routing decision for a request.
     *
     * Resolution order (matches the extension's background.ts):
     *   1. Cross-family translation (group binds to a different family)
     *   2. Same-family swap (group binds to a different openai-family
     *      provider with the same wire format)
     *   3. Direct credential for the provider the SDK called
     *
     * Returns null (signaling "no credential available") only when none of
     * the above yields a usable credential.
     */
    fun resolve(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: List<Credential>,
        engine: TranslationEngine,
    ): RoutingDecision? {
        // 1. Cross-family translation.
        val cross = tryCrossFamily(requestedProviderId, requestedModel, group, credentials, engine)
        if (cross != null) return cross

        // 2. Same-family swap.
        val swap = trySameFamilySwap(requestedProviderId, group, credentials, engine)
        if (swap != null) return swap

        // 3. Direct credential match. When the group also pins a model for
        // this provider, surface it so the proxy rewrites the body — the
        // group is the strongest routing force, stronger than the SDK's
        // model choice.
        val direct = credentials.firstOrNull { it.providerId == requestedProviderId }
        if (direct != null) {
            val override = if (group?.providerId == requestedProviderId) {
                group.model?.takeIf { it.isNotEmpty() }
            } else null
            return RoutingDecision(direct, translation = null, modelOverride = override)
        }

        return null
    }

    /**
     * Cross-family resolution. Returns null if any precondition fails.
     * Mirrors `resolveCrossFamilyRoute` exactly.
     */
    private fun tryCrossFamily(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: List<Credential>,
        engine: TranslationEngine,
    ): RoutingDecision? {
        if (group == null) return null
        if (group.providerId == requestedProviderId) return null
        val dstModel = group.model
        if (dstModel.isNullOrEmpty()) return null
        if (requestedModel.isNullOrEmpty()) return null

        // Family compatibility check via the JS bridge — single source of truth.
        if (!engine.shouldTranslate(requestedProviderId, group.providerId)) return null

        // Pin enforcement: when a pin is set we honor it strictly. A stale
        // pin returns null rather than silently swapping to a different
        // credential of the destination provider — that would mask the
        // user's cost-attribution intent.
        val cred = if (group.credentialId != null) {
            credentials.firstOrNull { it.id == group.credentialId } ?: return null
        } else {
            credentials.firstOrNull { it.providerId == group.providerId } ?: return null
        }

        return RoutingDecision(
            credential = cred,
            translation = RoutingTranslation(
                srcProviderId = requestedProviderId,
                dstProviderId = group.providerId,
                srcModel = requestedModel,
                dstModel = dstModel,
            )
        )
    }

    /**
     * Same-family swap resolution. Two providers in the same family (e.g.
     * Groq and OpenAI, both in the openai family) speak identical wire
     * protocols, so "routing" collapses to: swap credentials, rewrite the
     * destination URL, and optionally override the body's model field.
     *
     * Preconditions (all must hold):
     *   - a group exists
     *   - the group targets a *different* provider than what the SDK called
     *   - both providers are in the same family (per the JS bridge)
     *   - a credential is available for the destination
     *
     * Notably, `group.model` is *not* required here — a swap works even
     * when the group has no model pinned (we just forward the SDK's model).
     * If the group does pin a model, we pass it along as `swapDstModel`
     * so the caller can substitute it into the request body.
     */
    private fun trySameFamilySwap(
        requestedProviderId: String,
        group: Group?,
        credentials: List<Credential>,
        engine: TranslationEngine,
    ): RoutingDecision? {
        if (group == null) return null
        if (group.providerId == requestedProviderId) return null

        // Must be same family AND not a no-op.
        if (!engine.sameFamily(requestedProviderId, group.providerId)) return null

        // Strict pin enforcement: stale pin → null, no silent fallback to a
        // different credential of the destination provider.
        val cred = if (group.credentialId != null) {
            credentials.firstOrNull { it.id == group.credentialId } ?: return null
        } else {
            credentials.firstOrNull { it.providerId == group.providerId } ?: return null
        }

        return RoutingDecision(
            credential = cred,
            swapToProviderId = group.providerId,
            swapDstModel = group.model?.takeIf { it.isNotEmpty() },
        )
    }

    /**
     * Best-effort `model` extraction from a JSON request body. Returns null
     * for malformed bodies or when `model` is absent.
     */
    fun parseModel(body: ByteArray?): String? {
        if (body == null || body.isEmpty()) return null
        return try {
            val parsed = JSONObject(String(body, Charsets.UTF_8))
            parsed.optString("model", "").takeIf { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Detect whether a JSON request body asked for a streaming response.
     */
    fun isStreamingRequest(body: ByteArray?): Boolean {
        if (body == null) return false
        return try {
            val parsed = JSONObject(String(body, Charsets.UTF_8))
            parsed.optBoolean("stream", false)
        } catch (_: Exception) {
            false
        }
    }
}
