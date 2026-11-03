/**
 * Routing resolver — decides what credential and translation strategy to use
 * for a given (requestedProviderId, group) pair.
 *
 * This is the single source of truth for routing decisions in JS land. The
 * extension background script and any future Node consumer import these
 * functions instead of reimplementing the resolution rules.
 *
 * Mobile (Swift / Kotlin) has its own native ports of this logic — they
 * cannot share TS code, but they mirror it function-for-function. If you
 * change the rules here, update RoutingResolver.swift and RoutingResolver.kt
 * in lockstep.
 *
 * Resolution order:
 *   1. Cross-family translation — group binds to a different provider family
 *      AND a destination model is known (the group's own, or the provider's
 *      routing default from autoRouteModelFor). The request body, response,
 *      and SSE stream all get translated by the translation layer.
 *   2. Same-family swap — group binds to a different provider in the SAME
 *      family (e.g. Groq → OpenAI, both openai dialect). No translation; just
 *      a URL rewrite + credential swap + optional model substitution.
 *   3. Direct credential — no group, the default group, or a group bound to
 *      the provider the SDK called. Standard pass-through. A group bound to
 *      another provider never falls back to the app's own key: when steps 1
 *      and 2 can't serve it (no model to translate with, its key deleted, a
 *      stale pin), the request gets nothing, so a group meant to keep
 *      prompts on a local server can't quietly send them to a cloud key.
 *   4. Auto cross-family translation — no group, no direct credential, but the
 *      user holds a credential in a different translatable family. Silently
 *      pick one (most-recently-used first, then family order) and translate
 *      against that provider's routing model (autoRouteModelFor); providers
 *      without one are skipped. This is opportunistic: group rules above
 *      still win, so explicit user config is never overwritten. Local
 *      servers (Ollama, LM Studio) take no part on either end: a request
 *      meant for one is never sent to a cloud key, and none is picked.
 *   5. None of the above — the caller should surface a PROVIDER_UNAVAILABLE
 *      error (status 403) built via buildNoCredentialMessage to give the user
 *      actionable advice.
 *
 * A group's credential pin only counts when that credential belongs to the
 * group's provider. Groups are stored without integrity protection, so a pin
 * to another provider's key (tampered or stale) resolves to nothing instead
 * of sending that key, and the prompt, to the group's provider.
 */

import type {
  Credential,
  Group,
  ProviderId,
  SessionTranslation,
  SessionSwap,
} from './types.js';
// Import from the translate barrel (not families.js directly) so the side
// effects in translate/index.ts run — they register the family adapters that
// shouldTranslate / sameFamily consult. Without this, every consumer would
// need to import the barrel themselves before calling the resolver.
import { shouldTranslate, sameFamily } from './translate/index.js';
import { familyOf } from './translate/families.js';
import { DEFAULT_MODELS, type ModelFamily } from './models.js';
import { isLocalServerProvider } from './proxy-utils.js';
import { PROVIDERS } from './providers.js';

/**
 * The model routing names when it picks a provider and nothing else names
 * one: the auto cross-family fallback, and a cross-family group saved
 * without a model. Only ids each provider is known to serve. The family
 * flagship from DEFAULT_MODELS is an OpenAI id, which DeepSeek, Groq,
 * Mistral and the other OpenAI-compatible providers reject, so they are left
 * out, as are Azure (the model names a deployment) and the local servers
 * (Ollama, LM Studio), whose models only the user knows.
 */
const AUTO_ROUTE_MODELS: Partial<Record<ProviderId, string>> = {
  anthropic: DEFAULT_MODELS.anthropic,
  openai: DEFAULT_MODELS.openai,
  gemini: DEFAULT_MODELS.gemini,
  cohere: DEFAULT_MODELS.cohere,
  // OpenRouter names OpenAI's models with an `openai/` prefix.
  openrouter: `openai/${DEFAULT_MODELS.openai}`,
};

/**
 * The model routing uses for `providerId` when nothing else names one, or
 * undefined when routing can't pick one for that provider (see
 * AUTO_ROUTE_MODELS). Exposed to the mobile apps through the core bundle so
 * all platforms pick the same model.
 */
export function autoRouteModelFor(providerId: ProviderId): string | undefined {
  return Object.prototype.hasOwnProperty.call(AUTO_ROUTE_MODELS, providerId)
    ? AUTO_ROUTE_MODELS[providerId]
    : undefined;
}

/**
 * The credential a group's pin names, if it belongs to the group's provider.
 * A pin to another provider's key resolves to nothing, like a stale pin.
 */
function pinnedCredential(group: Group, credentials: Credential[]): Credential | undefined {
  return credentials.find(
    (c) => c.id === group.credentialId && c.providerId === group.providerId,
  );
}

/**
 * The full routing decision for a single (requestedProviderId, group) pair.
 *
 * Exactly one of `translation` and `swap` may be set; both being absent means
 * the resolver picked a direct credential (or fell through to default).
 *
 * `modelOverride` is orthogonal to those branches: when the group pins a
 * model, the proxy rewrites the outgoing body's `model` field to it. For
 * cross-family (translation) and same-family-swap paths, the pinned model is
 * already carried in translation.dstModel / swap.dstModel. `modelOverride` is
 * the direct-path (same-provider) carrier — without it, a group's model pin
 * is silently dropped when the app already targets the group's provider.
 */
export interface RoutingDecision {
  credential: Credential;
  translation?: SessionTranslation;
  swap?: SessionSwap;
  modelOverride?: string;
}

/**
 * Resolve a routing decision for a single requested provider. Returns null
 * when no credential of any kind is available for this request — the caller
 * should then build a NO_CREDENTIAL response with buildNoCredentialMessage.
 *
 * `group` may be undefined when the app has no explicit group binding (the
 * caller treats this as the default group, with whatever default credential
 * and model the user picked).
 */
export function resolveRoute(
  requestedProviderId: ProviderId,
  group: Group | undefined,
  credentials: Credential[],
): RoutingDecision | null {
  // 1. Cross-family translation.
  const cross = resolveCrossFamilyRoute(group, requestedProviderId, credentials);
  if (cross) {
    return { credential: cross.cred, translation: cross.translation };
  }

  // 2. Same-family swap.
  const swap = resolveSameFamilySwapRoute(group, requestedProviderId, credentials);
  if (swap) {
    return { credential: swap.cred, swap: swap.swap };
  }

  // 3. Direct credential. Two sub-cases:
  //    (a) Group binds the requested provider AND pins a specific credential
  //        id → return that pin verbatim. If the pin id no longer exists (or
  //        names another provider's key), return null. We deliberately do NOT
  //        silently fall back to a different credential of the same provider
  //        — pins exist for cost attribution and a silent swap masks the
  //        user's intent.
  //    (b) No pin → use any credential of the provider, most-recently-used
  //        first.
  //    A group bound to another provider that steps 1 and 2 couldn't serve
  //    gets null, not the app's own key: the user routed this app away from
  //    that provider (the caller's buildNoCredentialMessage says what's
  //    missing: a model on the group, or the group's key).
  //
  // In both sub-cases, when the group also pins a model, surface it as
  // `modelOverride` so the proxy rewrites the outgoing body. The group is
  // the strongest routing force — it must override the app's model choice
  // even when no provider swap / translation is needed.
  const modelOverride =
    group && group.providerId === requestedProviderId && group.model
      ? group.model
      : undefined;
  if (group && group.providerId === requestedProviderId && group.credentialId) {
    const pinned = pinnedCredential(group, credentials);
    return pinned ? { credential: pinned, modelOverride } : null;
  }
  if (group?.providerId && group.providerId !== requestedProviderId) return null;
  const direct = credentials.find((c) => c.providerId === requestedProviderId);
  if (direct) return { credential: direct, modelOverride };

  // 4. Auto cross-family translation. Opportunistic fallback — fires only
  //    when steps 1–3 all miss AND the app has no group binding. A group
  //    expresses the user's explicit routing intent, so we never silently
  //    route around it even when every group-based path fails to resolve a
  //    credential (stale pin, missing dst key, etc.) — returning null in
  //    those cases surfaces the stale config via PROVIDER_UNAVAILABLE so the
  //    user notices and fixes it. The default group binds nothing (empty
  //    providerId), so apps in it count as unbound.
  if (!group?.providerId) {
    const auto = resolveAutoCrossFamilyRoute(requestedProviderId, credentials);
    if (auto) {
      return { credential: auto.cred, translation: auto.translation };
    }
  }

  return null;
}

/**
 * Auto cross-family translation — tier-4 fallback. Fires when the user has
 * no credential for the requested provider and no group binding steering
 * them elsewhere. Picks any translatable credential they hold, targeting the
 * model autoRouteModelFor names for its provider. Credentials of providers
 * it names none for (OpenAI-compatible hosts other than OpenAI and
 * OpenRouter, Azure, local servers) are skipped: routing would otherwise send
 * them a model they don't serve.
 *
 * Candidate ordering:
 *  1. Most-recently-used credential first (lastUsedAt desc). A user who just
 *     approved a request against their Anthropic key almost certainly wants
 *     the next cross-family hit to land there too.
 *  2. Tiebreak by family preference: anthropic > openai > gemini > cohere.
 *     Arbitrary but deterministic — picks the family with the broadest
 *     translation coverage first.
 *  3. Tiebreak by createdAt desc (newest credential first).
 *
 * Returns undefined in four cases:
 *  - the user already holds a credential for the requested provider (caller
 *    will have picked that via the direct path and never reach us; this is
 *    defensive)
 *  - the requested provider is a local server (Ollama, LM Studio): the app
 *    asked for a model on the user's own machine, so its prompts must not
 *    silently go to a paid cloud provider. A group can still route it.
 *  - the requested provider itself is outside any known family (translation
 *    needs both ends in a family)
 *  - no credential in the user's wallet is translatable against the request
 *    with a model routing can name
 */
export function resolveAutoCrossFamilyRoute(
  requestedProviderId: ProviderId,
  credentials: Credential[],
): { cred: Credential; translation: SessionTranslation } | undefined {
  if (credentials.some((c) => c.providerId === requestedProviderId)) {
    return undefined;
  }
  if (isLocalServerProvider(requestedProviderId)) return undefined;
  if (!familyOf(requestedProviderId)) return undefined;

  const sorted = [...credentials].sort((a, b) => {
    const byUse = (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
    if (byUse !== 0) return byUse;
    const byFamily = familyOrder(a.providerId) - familyOrder(b.providerId);
    if (byFamily !== 0) return byFamily;
    return b.createdAt - a.createdAt;
  });

  for (const cred of sorted) {
    if (!shouldTranslate(requestedProviderId, cred.providerId)) continue;
    const dstModel = autoRouteModelFor(cred.providerId);
    if (!dstModel) continue;
    return {
      cred,
      translation: {
        srcProviderId: requestedProviderId,
        dstProviderId: cred.providerId,
        dstModel,
      },
    };
  }

  return undefined;
}

const FAMILY_ORDER: Record<ModelFamily, number> = {
  anthropic: 0,
  openai: 1,
  gemini: 2,
  cohere: 3,
};

function familyOrder(providerId: ProviderId): number {
  const f = familyOf(providerId);
  return f ? FAMILY_ORDER[f] : 99;
}

/**
 * Cross-family routing. Returns undefined unless ALL of the following hold:
 *  1. A group is set
 *  2. group.providerId !== requestedProviderId
 *  3. A destination model is known: group.model, or else the provider's
 *     routing default (autoRouteModelFor). The group editor calls the model
 *     optional; without a default (Azure, local servers, most
 *     OpenAI-compatible hosts) the group needs one.
 *  4. The provider pair is translatable (both in known families with adapters)
 *  5. A credential of group.providerId resolves — pin is enforced strictly
 *     (no silent fallback to any-credential-of-provider when the pin id is
 *     stale; that would mask cost-attribution intent)
 */
export function resolveCrossFamilyRoute(
  group: Group | undefined,
  requestedProviderId: ProviderId,
  credentials: Credential[],
): { cred: Credential; translation: SessionTranslation } | undefined {
  if (!group) return undefined;
  if (group.providerId === requestedProviderId) return undefined;
  const dstModel = group.model || autoRouteModelFor(group.providerId);
  if (!dstModel) return undefined;
  if (!shouldTranslate(requestedProviderId, group.providerId)) return undefined;

  // When a pin is set we honor it strictly: a stale pin returns undefined
  // rather than silently swapping to a different credential of the same
  // provider. The caller surfaces PROVIDER_UNAVAILABLE so the user notices.
  const cred = group.credentialId
    ? pinnedCredential(group, credentials)
    : credentials.find((c) => c.providerId === group.providerId);
  if (!cred) return undefined;

  return {
    cred,
    translation: {
      srcProviderId: requestedProviderId,
      dstProviderId: group.providerId,
      dstModel,
    },
  };
}

/**
 * Same-family swap. Two providers in the same family speak identical wire
 * protocols, so "routing" collapses to: swap credentials, rewrite the
 * destination URL, and (optionally) override the body's model field.
 *
 * Conditions:
 *  1. A group is set
 *  2. group.providerId !== requestedProviderId
 *  3. Both providers live in the same family (per sameFamily())
 *  4. A credential resolves for group.providerId — pin is enforced strictly
 *     (a stale pin returns undefined, no silent fallback)
 *
 * Notably, group.model is NOT required — a swap works even when the group
 * has no model pinned. If present, it flows into SessionSwap.dstModel so the
 * proxy handler can substitute it into the request body.
 */
export function resolveSameFamilySwapRoute(
  group: Group | undefined,
  requestedProviderId: ProviderId,
  credentials: Credential[],
): { cred: Credential; swap: SessionSwap } | undefined {
  if (!group) return undefined;
  if (group.providerId === requestedProviderId) return undefined;
  if (!sameFamily(requestedProviderId, group.providerId)) return undefined;

  // Strict pin enforcement: stale pin → undefined, never silently swap.
  const cred = group.credentialId
    ? pinnedCredential(group, credentials)
    : credentials.find((c) => c.providerId === group.providerId);
  if (!cred) return undefined;

  return {
    cred,
    swap: {
      srcProviderId: requestedProviderId,
      dstProviderId: group.providerId,
      dstModel: group.model || undefined,
    },
  };
}

/**
 * Build an actionable message for the PROVIDER_UNAVAILABLE error the caller
 * sends when the resolver returns null. This function picks the right
 * message for the data shape:
 *   1. Group binds to a provider != requested → user has a routing rule but
 *      it can't be served. If they hold a key for the destination, the group
 *      needs a model to translate with (no routing default for that
 *      provider); otherwise tell them to add the key or rebind the group.
 *   2. Group binds to the requested provider (or no group) and the user has
 *      *some* credentials → tell them to move the app to a group bound to
 *      one of their existing keys, or add the missing key.
 *   3. Wallet is empty → tell them to add any key.
 */
export function buildNoCredentialMessage(
  requestedProviderId: ProviderId,
  userCredentialProviderIds: ProviderId[],
  group: Group | undefined,
): string {
  const req = requestedProviderId;
  const groupBinding = group?.providerId;
  if (groupBinding && groupBinding !== req) {
    const modelMissing = !group?.model && !autoRouteModelFor(groupBinding);
    if (modelMissing && userCredentialProviderIds.includes(groupBinding) && shouldTranslate(req, groupBinding)) {
      return `This app's group routes it to ${providerName(groupBinding)}, which needs a model to translate ${providerName(req)} requests. Set a model on the group.`;
    }
    return `No API key for ${providerName(groupBinding)} found. Add one to your wallet, or assign this app to a provider you already have a key for.`;
  }
  if (userCredentialProviderIds.length > 0) {
    const list = userCredentialProviderIds.map(providerName).join(', ');
    return `No API key for ${providerName(req)} found. You have keys for: ${list}. Add one, or assign this app to one of those providers.`;
  }
  return `No API keys in your wallet. Add a key for any provider to get started.`;
}

/** A provider's display name ("Ollama (local)"), or its id when unknown. */
function providerName(providerId: string): string {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, providerId) ? PROVIDERS[providerId].name : providerId;
}
