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
     * Returns null (signaling "no credential available") if neither the
     * requested provider nor any cross-family destination has a credential.
     * Returns a decision with `translation == null` for normal pass-through.
     * Returns a decision with `translation != null` for cross-family routes.
     */
    fun resolve(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: List<Credential>,
        engine: TranslationEngine,
    ): RoutingDecision? {
        // Try cross-family routing first — wins over both gifts and direct
        // credentials when applicable, matching the extension's resolution order.
        val cross = tryCrossFamily(requestedProviderId, requestedModel, group, credentials, engine)
        if (cross != null) return cross

        // Direct match — credential for the provider the SDK called.
        val direct = credentials.firstOrNull { it.providerId == requestedProviderId }
        if (direct != null) return RoutingDecision(direct, translation = null)

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

        // Credential preference: pinned first, fallback to any credential for the destination provider.
        val pinned = group.credentialId?.let { id -> credentials.firstOrNull { it.id == id } }
        val cred = pinned ?: credentials.firstOrNull { it.providerId == group.providerId } ?: return null

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
