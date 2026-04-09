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

  // 3. Direct credential. If the group has a credential pin and that pin is
  //    for the requested provider, prefer it; otherwise fall back to the
  //    most recently used credential for the provider.
  if (group && group.providerId === requestedProviderId && group.credentialId) {
    const pinned = credentials.find((c) => c.id === group.credentialId);
    if (pinned) return { credential: pinned };
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
 *  5. A credential exists for group.providerId (pinned id preferred)
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

  const cred =
    (group.credentialId
      ? credentials.find((c) => c.id === group.credentialId)
      : undefined) ?? credentials.find((c) => c.providerId === group.providerId);
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
 * Same-family swap. Two providers in the same family speak identical wire
 * protocols, so "routing" collapses to: swap credentials, rewrite the
 * destination URL, and (optionally) override the body's model field.
 *
 * Conditions:
 *  1. A group is set
 *  2. group.providerId !== requestedProviderId
 *  3. Both providers live in the same family (per sameFamily())
 *  4. A credential exists for group.providerId (pinned id preferred)
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

  const cred =
    (group.credentialId
      ? credentials.find((c) => c.id === group.credentialId)
      : undefined) ?? credentials.find((c) => c.providerId === group.providerId);
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
    return `This app is bound to a group that routes to ${groupBinding}, but you have no ${groupBinding} credential in your wallet. Add a ${groupBinding} credential, or rebind this group to a provider you do have a key for.`;
  }
  if (userCredentialProviderIds.length > 0) {
    const list = userCredentialProviderIds.join(', ');
    return `This app requested ${req} but you have no ${req} credential. You have keys for: ${list}. Move this app to a group bound to one of those providers, or add a ${req} key.`;
  }
  return `This app requested ${req} but your wallet has no credentials. Add a key — you can use any provider; routing will direct requests to it automatically.`;
}
