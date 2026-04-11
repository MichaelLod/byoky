/**
 * Routing resolver — decides what credential and translation strategy to use
 * for a given (requestedProviderId, group) pair.
 *
 * This is the single source of truth for routing decisions in JS land. The
 * extension background script, the cloud vault, and any future Node consumer
 * all import these functions instead of reimplementing the resolution rules.
 *
 * Mobile (Swift / Kotlin) has its own native ports of this logic — they
 * cannot share TS code, but they mirror it function-for-function. If you
 * change the rules here, update RoutingResolver.swift and RoutingResolver.kt
 * in lockstep.
 *
 * Resolution order:
 *   1. Cross-family translation — group binds to a different provider family
 *      AND has a model pinned. The request body, response, and SSE stream all
 *      get translated by the translation layer.
 *   2. Same-family swap — group binds to a different provider in the SAME
 *      family (e.g. Groq → OpenAI, both openai dialect). No translation; just
 *      a URL rewrite + credential swap + optional model substitution.
 *   3. Direct credential — no group, or group binds to the same provider the
 *      SDK called. Standard pass-through.
 *   4. None of the above — the caller should surface a NO_CREDENTIAL error
 *      built via buildNoCredentialMessage to give the user actionable advice.
 */

import type {
  Credential,
  Group,
  ProviderId,
  SessionTranslation,
  SessionSwap,
} from './types.js';
import type { GiftedCredential } from './gift.js';
import { isGiftExpired } from './gift.js';
// Import from the translate barrel (not families.js directly) so the side
// effects in translate/index.ts run — they register the family adapters that
// shouldTranslate / sameFamily consult. Without this, every consumer would
// need to import the barrel themselves before calling the resolver.
import { shouldTranslate, sameFamily } from './translate/index.js';

/**
 * The full routing decision for a single (requestedProviderId, group) pair.
 *
 * Exactly one of `translation` and `swap` may be set; both being absent means
 * the resolver picked a direct credential (or fell through to default).
 */
export interface RoutingDecision {
  credential: Credential;
  translation?: SessionTranslation;
  swap?: SessionSwap;
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
  //        id → return that pin verbatim. If the pin id no longer exists,
  //        return null. We deliberately do NOT silently fall back to a
  //        different credential of the same provider — pins exist for cost
  //        attribution and a silent swap masks the user's intent.
  //    (b) No pin → use any credential of the provider, most-recently-used
  //        first.
  if (group && group.providerId === requestedProviderId && group.credentialId) {
    const pinned = credentials.find((c) => c.id === group.credentialId);
    return pinned ? { credential: pinned } : null;
  }
  const direct = credentials.find((c) => c.providerId === requestedProviderId);
  if (direct) return { credential: direct };

  return null;
}

/**
 * Cross-family routing. Returns undefined unless ALL of the following hold:
 *  1. A group is set
 *  2. group.providerId !== requestedProviderId
 *  3. group.model is set (translation can't pick a destination model on its own)
 *  4. The provider pair is translatable (both in known families with adapters)
 *  5. A credential resolves for group.providerId — pin is enforced strictly
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
  if (!group.model) return undefined;
  if (!shouldTranslate(requestedProviderId, group.providerId)) return undefined;

  // When a pin is set we honor it strictly: a stale pin returns undefined
  // rather than silently swapping to a different credential of the same
  // provider. The caller surfaces NO_CREDENTIAL so the user notices.
  const cred = group.credentialId
    ? credentials.find((c) => c.id === group.credentialId)
    : credentials.find((c) => c.providerId === group.providerId);
  if (!cred) return undefined;

  return {
    cred,
    translation: {
      srcProviderId: requestedProviderId,
      dstProviderId: group.providerId,
      dstModel: group.model,
    },
  };
}

/**
 * Cross-family routing via a gifted credential. Mirrors
 * `resolveCrossFamilyRoute` but returns a gift as the destination instead
 * of an owned credential. Fires when:
 *  1. A group is set
 *  2. group.providerId !== requestedProviderId
 *  3. group.giftId is explicitly pinned (no implicit gift selection — we
 *     only reroute through a gift when the user asked for it by pinning
 *     it in the group)
 *  4. group.model is set (translation can't pick a destination model)
 *  5. The provider pair is translatable (both in known families)
 *  6. The pinned gift still exists, is not expired, and has budget left
 *
 * The recipient applies request-body translation src→dst before sending
 * the translated request through the gift relay; the sender sees it as a
 * native dst-provider call against its own dst-provider key. Response
 * chunks/body are translated dst→src on the recipient side before
 * returning to the caller.
 */
export function resolveCrossFamilyGiftRoute(
  group: Group | undefined,
  requestedProviderId: ProviderId,
  giftedCredentials: GiftedCredential[],
): { gc: GiftedCredential; translation: SessionTranslation } | undefined {
  if (!group) return undefined;
  if (group.providerId === requestedProviderId) return undefined;
  if (!group.giftId) return undefined;
  if (!group.model) return undefined;
  if (!shouldTranslate(requestedProviderId, group.providerId)) return undefined;

  const gc = giftedCredentials.find(
    (g) => g.giftId === group.giftId && !isGiftExpired(g) && g.usedTokens < g.maxTokens,
  );
  if (!gc) return undefined;

  return {
    gc,
    translation: {
      srcProviderId: requestedProviderId,
      dstProviderId: group.providerId,
      dstModel: group.model,
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
    ? credentials.find((c) => c.id === group.credentialId)
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
 * Build an actionable NO_CREDENTIAL error message. The resolver returns null
 * for one of three reasons; this function picks the right message for each.
 *
 * Three branches by data shape:
 *   1. Group binds to a provider != requested → user has a routing rule but
 *      the destination has no key. Tell them to add it or rebind the group.
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
    return `No ${groupBinding} API key found. Add a ${groupBinding} key to your wallet, or assign this app to a provider you already have a key for.`;
  }
  if (userCredentialProviderIds.length > 0) {
    const list = userCredentialProviderIds.join(', ');
    return `No ${req} API key found. You have keys for: ${list}. Add a ${req} key, or assign this app to one of those providers.`;
  }
  return `No API keys in your wallet. Add a key for any provider to get started.`;
}
