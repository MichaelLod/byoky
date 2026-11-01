package com.byoky.app.proxy

import com.byoky.app.data.Credential
import com.byoky.app.data.Group
import com.byoky.app.data.RoutingDecision
import com.byoky.app.data.RoutingTranslation
import okhttp3.HttpUrl
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
 * The group comes from `WalletStore.groupForOrigin(appOrigin)`: the in-wallet
 * browser passes each app's origin, so per-app group bindings apply.
 */
object RoutingResolver {

    /**
     * Family questions answered by the bundled core (see [TranslationEngine]);
     * an interface so the resolver can be unit-tested without the sandbox.
     */
    interface Families {
        fun shouldTranslate(srcProviderId: String, dstProviderId: String): Boolean
        fun sameFamily(srcProviderId: String, dstProviderId: String): Boolean

        /**
         * The model routing names for [providerId] when nothing else does
         * (core `autoRouteModelFor`), or null when routing must skip it.
         */
        fun autoRouteModel(providerId: String): String?
    }

    /**
     * Resolve the routing decision for a request.
     *
     * Resolution order (matches the extension's background.ts):
     *   1. Cross-family translation (group binds to a different family)
     *   2. Same-family swap (group binds to a different openai-family
     *      provider with the same wire format)
     *   3. Direct credential for the provider the SDK called
     *   4. Auto cross-family translation — opportunistic fallback when the
     *      user holds credentials only in other families and the app has no
     *      group binding. Skipped when a group is set (group intent wins).
     *
     * Returns null (signaling "no credential available") only when none of
     * the above yields a usable credential.
     *
     * A group's credential pin only counts when that key belongs to the
     * group's provider (core's `pinnedCredential`): groups aren't integrity
     * protected, and a pin to another provider's key must never send that
     * key to the group's provider.
     */
    fun resolve(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: List<Credential>,
        engine: Families,
    ): RoutingDecision? {
        // 1. Cross-family translation.
        val cross = tryCrossFamily(requestedProviderId, requestedModel, group, credentials, engine)
        if (cross != null) return cross

        // 2. Same-family swap.
        val swap = trySameFamilySwap(requestedProviderId, group, credentials, engine)
        if (swap != null) return swap

        // 3. Direct credential, honoring the group's pinned key and model.
        resolveDirect(requestedProviderId, group, credentials)?.let { return it }

        // 4. Auto cross-family translation. Fires only when the app has no
        //    explicit group binding — the default sentinel group (empty
        //    providerId) counts as "no binding" because the user hasn't
        //    expressed routing intent. When the user HAS set a group, we
        //    never silently route around it; returning null here surfaces
        //    PROVIDER_UNAVAILABLE so the stale config gets noticed.
        val hasExplicitGroup = group != null && group.providerId.isNotEmpty()
        if (!hasExplicitGroup) {
            val auto = tryAutoCrossFamily(requestedProviderId, requestedModel, credentials, engine)
            if (auto != null) return auto
        }

        return null
    }

    /**
     * Direct credential for the provider the app called. Mirrors step 3 of
     * `resolveRoute` in packages/core/src/routing.ts: when the app's group
     * binds this same provider and pins a key, that key is used, and a pin
     * whose key is gone gives null rather than silently switching to another
     * key (pins are for cost attribution). Otherwise the first key of the
     * provider. A model the group pins is surfaced as `modelOverride`: the
     * group is the strongest routing force, stronger than the app's choice.
     */
    fun resolveDirect(requestedProviderId: String, group: Group?, credentials: List<Credential>): RoutingDecision? {
        val bindsProvider = group != null && group.providerId == requestedProviderId
        val override = if (bindsProvider) group?.model?.takeIf { it.isNotEmpty() } else null
        val pin = if (bindsProvider) group?.credentialId else null
        val credential = if (pin != null) {
            credentials.firstOrNull { it.id == pin && it.providerId == requestedProviderId }
        } else {
            credentials.firstOrNull { it.providerId == requestedProviderId }
        } ?: return null
        return RoutingDecision(credential, translation = null, modelOverride = override)
    }

    /**
     * Whether a request for [providerId] from an app in [group] can be
     * served at all, and with which key: [resolve] with any model. A connect
     * request names no model, while the proxy routes every request that
     * carries one, so availability must not depend on it. Used for the
     * connect response's per-provider `available` flags.
     */
    fun canServe(providerId: String, group: Group?, credentials: List<Credential>, engine: Families): Credential? =
        resolve(providerId, ANY_MODEL, group, credentials, engine)?.credential

    /** Stand-in source model for [canServe]; never sent anywhere. */
    private const val ANY_MODEL = "*"

    /** User-run local servers (core `isLocalServerProvider`). */
    private val LOCAL_SERVER_PROVIDERS = setOf("ollama", "lm_studio")

    /**
     * Auto cross-family fallback — mirrors `resolveAutoCrossFamilyRoute` in
     * `packages/core/src/routing.ts`. Picks a translatable credential from
     * the user's wallet when the app asks for a provider they don't hold.
     *
     * Candidate ordering (`Credential` on Android has no `lastUsedAt` yet, so
     * MRU degrades to family order + createdAt):
     *   1. Family preference: anthropic > openai > gemini > cohere > other
     *   2. Tiebreak by `createdAt` desc (newest credential first)
     *
     * The destination model is core's `autoRouteModelFor` for the
     * candidate's provider; providers it names none for (OpenAI-compatible
     * hosts other than OpenAI and OpenRouter, Azure, Ollama, LM Studio) are
     * skipped. `srcModel` is taken from the inbound request body.
     *
     * A request meant for a local server (Ollama, LM Studio) is never
     * auto-routed: the app asked for a model on the user's own machine, so
     * its prompts must not silently go to a paid cloud key. A group can
     * still route it (core's `resolveAutoCrossFamilyRoute` does the same).
     */
    private fun tryAutoCrossFamily(
        requestedProviderId: String,
        requestedModel: String?,
        credentials: List<Credential>,
        engine: Families,
    ): RoutingDecision? {
        // Defensive: the direct-match branch above would have taken it, but
        // guard for callers invoking this method in isolation.
        if (credentials.any { it.providerId == requestedProviderId }) return null
        if (requestedProviderId in LOCAL_SERVER_PROVIDERS) return null
        if (requestedModel.isNullOrEmpty()) return null

        for (cred in autoCandidateOrder(credentials)) {
            if (!engine.shouldTranslate(requestedProviderId, cred.providerId)) continue
            val dstModel = engine.autoRouteModel(cred.providerId)?.takeIf { it.isNotEmpty() } ?: continue
            return RoutingDecision(
                credential = cred,
                translation = RoutingTranslation(
                    srcProviderId = requestedProviderId,
                    dstProviderId = cred.providerId,
                    srcModel = requestedModel,
                    dstModel = dstModel,
                )
            )
        }
        return null
    }

    /**
     * Auto cross-family candidate order: family preference, then newest
     * first. `createdAt` values in the future are treated as "now", so a
     * credential with a forged timestamp (for example from an imported file)
     * can't jump the queue.
     */
    internal fun autoCandidateOrder(credentials: List<Credential>, now: Long = System.currentTimeMillis()): List<Credential> =
        credentials.sortedWith(
            compareBy<Credential> { familyOrder(it.providerId) }
                .thenByDescending { minOf(it.createdAt, now) }
        )

    /**
     * Family preference index for tiebreaking auto cross-family candidate
     * ordering. Mirrors `FAMILY_ORDER` in routing.ts — keep in lockstep.
     * Ollama and LM Studio (openai family in core) stay at 99: auto-routing
     * never picks them, as there is no model it could name for them.
     */
    private fun familyOrder(providerId: String): Int = when (providerId) {
        "anthropic" -> 0
        "openai", "azure_openai", "groq", "together", "deepseek",
        "xai", "perplexity", "fireworks", "openrouter", "mistral" -> 1
        "gemini" -> 2
        "cohere" -> 3
        else -> 99
    }

    /**
     * Cross-family resolution. Returns null if any precondition fails.
     * Mirrors `resolveCrossFamilyRoute` exactly: the destination model is
     * the group's, or else core's routing default for the group's provider.
     */
    private fun tryCrossFamily(
        requestedProviderId: String,
        requestedModel: String?,
        group: Group?,
        credentials: List<Credential>,
        engine: Families,
    ): RoutingDecision? {
        if (group == null) return null
        if (group.providerId == requestedProviderId) return null
        val dstModel = group.model?.takeIf { it.isNotEmpty() }
            ?: engine.autoRouteModel(group.providerId)?.takeIf { it.isNotEmpty() }
            ?: return null
        if (requestedModel.isNullOrEmpty()) return null

        // Family compatibility check via the JS bridge — single source of truth.
        if (!engine.shouldTranslate(requestedProviderId, group.providerId)) return null

        // Pin enforcement: when a pin is set we honor it strictly. A stale
        // pin returns null rather than silently swapping to a different
        // credential of the destination provider — that would mask the
        // user's cost-attribution intent. A pin to another provider's key
        // counts as stale.
        val cred = if (group.credentialId != null) {
            credentials.firstOrNull { it.id == group.credentialId && it.providerId == group.providerId } ?: return null
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
        engine: Families,
    ): RoutingDecision? {
        if (group == null) return null
        if (group.providerId == requestedProviderId) return null

        // Must be same family AND not a no-op.
        if (!engine.sameFamily(requestedProviderId, group.providerId)) return null

        // Strict pin enforcement: stale pin → null, no silent fallback to a
        // different credential of the destination provider. A pin to another
        // provider's key counts as stale.
        val cred = if (group.credentialId != null) {
            credentials.firstOrNull { it.id == group.credentialId && it.providerId == group.providerId } ?: return null
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
     * The model a request names: the body's `model`, or for Gemini, whose
     * body has none, the `{model}` of `…/models/{model}:{action}` in the URL.
     */
    fun requestModel(providerId: String, url: HttpUrl, body: ByteArray?): String? =
        parseModel(body) ?: if (providerId == "gemini") geminiModel(url) else null

    /** `gemini-2.5-pro` for `/v1beta/models/gemini-2.5-pro:generateContent`, else null. */
    fun geminiModel(url: HttpUrl): String? {
        val segments = url.pathSegments
        val i = segments.indexOfLast { it == "models" }
        if (i < 0 || i + 1 >= segments.size) return null
        val model = segments[i + 1].substringBefore(':')
        return model.takeIf { it.isNotEmpty() }
    }

    /**
     * Whether the app asked for a streaming response. Gemini says so in the
     * URL (`:streamGenerateContent`, usually with `?alt=sse`); everyone else
     * with `"stream": true` in the body.
     */
    fun isStreamingRequest(providerId: String, url: HttpUrl, body: ByteArray?): Boolean {
        if (providerId == "gemini") {
            return url.pathSegments.lastOrNull()?.substringAfterLast(':', "") == "streamGenerateContent"
        }
        return isStreamingRequest(body)
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
