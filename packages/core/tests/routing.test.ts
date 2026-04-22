import { describe, it, expect } from 'vitest';
import {
  resolveRoute,
  resolveCrossFamilyRoute,
  resolveCrossFamilyGiftRoute,
  resolveSameFamilySwapRoute,
  resolveAutoCrossFamilyRoute,
  buildNoCredentialMessage,
} from '../src/routing.js';
import type { Credential, Group } from '../src/types.js';
import type { GiftedCredential } from '../src/gift.js';

function cred(id: string, providerId: string): Credential {
  return {
    id,
    providerId,
    label: `${providerId} key`,
    authMethod: 'api_key',
    encryptedKey: 'encrypted',
    createdAt: 0,
  };
}

function group(
  providerId: string,
  opts: { model?: string; credentialId?: string; giftId?: string } = {},
): Group {
  return {
    id: 'g1',
    name: 'Test',
    providerId,
    credentialId: opts.credentialId,
    giftId: opts.giftId,
    model: opts.model,
    createdAt: 0,
  };
}

function giftedCred(
  id: string,
  providerId: string,
  opts: {
    giftId?: string;
    maxTokens?: number;
    usedTokens?: number;
    expiresAt?: number;
  } = {},
): GiftedCredential {
  return {
    id,
    giftId: opts.giftId ?? `gift_${id}`,
    providerId,
    providerName: providerId,
    senderLabel: 'Someone',
    authToken: 'tok_secret',
    maxTokens: opts.maxTokens ?? 100_000,
    usedTokens: opts.usedTokens ?? 0,
    expiresAt: opts.expiresAt ?? Date.now() + 86_400_000,
    relayUrl: 'wss://relay.byoky.com/ws',
    createdAt: 0,
  };
}

describe('resolveRoute', () => {
  describe('cross-family translation', () => {
    it('routes openai → anthropic when group binds anthropic with model', () => {
      const credentials = [cred('c1', 'anthropic'), cred('c2', 'openai')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision).not.toBeNull();
      expect(decision!.credential.id).toBe('c1');
      expect(decision!.translation).toEqual({
        srcProviderId: 'openai',
        dstProviderId: 'anthropic',
        dstModel: 'claude-sonnet-4-5',
      });
      expect(decision!.swap).toBeUndefined();
    });

    it('skips cross-family when group has no model', () => {
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic'); // no model

      const decision = resolveRoute('openai', g, credentials);

      // No model → no cross-family. Falls through to direct lookup, which
      // also fails (no openai credential).
      expect(decision).toBeNull();
    });

    it('prefers pinned credential id over any-of-provider lookup', () => {
      const credentials = [cred('c1', 'anthropic'), cred('c2', 'anthropic')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5', credentialId: 'c2' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c2');
    });

    it('returns null when pin id is stale (no silent fallback)', () => {
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5', credentialId: 'missing' });

      const decision = resolveRoute('openai', g, credentials);

      // A stale pin must NOT silently swap to a different credential of the
      // same provider — that would mask cost-attribution intent. The caller
      // surfaces NO_CREDENTIAL so the user notices the pin is gone.
      expect(decision).toBeNull();
    });
  });

  describe('same-family swap', () => {
    it('routes groq → openai (both openai family) without translation', () => {
      const credentials = [cred('c1', 'openai')];
      const g = group('openai');

      const decision = resolveRoute('groq', g, credentials);

      expect(decision).not.toBeNull();
      expect(decision!.credential.id).toBe('c1');
      expect(decision!.swap).toEqual({
        srcProviderId: 'groq',
        dstProviderId: 'openai',
        dstModel: undefined,
      });
      expect(decision!.translation).toBeUndefined();
    });

    it('passes group model into swap when set', () => {
      const credentials = [cred('c1', 'openai')];
      const g = group('openai', { model: 'gpt-4o' });

      const decision = resolveRoute('groq', g, credentials);

      expect(decision!.swap?.dstModel).toBe('gpt-4o');
    });

    it('does not swap when both providers are the same', () => {
      const credentials = [cred('c1', 'openai')];
      const g = group('openai');

      const decision = resolveRoute('openai', g, credentials);

      // No swap (same provider). Falls through to direct.
      expect(decision!.swap).toBeUndefined();
      expect(decision!.translation).toBeUndefined();
      expect(decision!.credential.id).toBe('c1');
    });
  });

  describe('direct credential', () => {
    it('returns direct credential when no group is set', () => {
      const credentials = [cred('c1', 'openai')];

      const decision = resolveRoute('openai', undefined, credentials);

      expect(decision!.credential.id).toBe('c1');
      expect(decision!.translation).toBeUndefined();
      expect(decision!.swap).toBeUndefined();
    });

    it('returns null when no credential matches and nothing translatable', () => {
      // Requesting an unknown provider with credentials only in other
      // families — auto cross-family also can't fire because the source is
      // outside any known family.
      const credentials = [cred('c1', 'anthropic')];

      const decision = resolveRoute('unknown' as never, undefined, credentials);

      expect(decision).toBeNull();
    });

    it('honors group pin to the same provider as requested', () => {
      const credentials = [cred('c1', 'openai'), cred('c2', 'openai')];
      const g = group('openai', { credentialId: 'c2' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c2');
    });

    it('surfaces modelOverride when same-provider group pins a model', () => {
      // The group is the strongest routing force — its model must override
      // whatever the SDK put in the body. Without this, a user who pinned
      // Opus in the group would still see Sonnet if the app hardcoded it.
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic', { model: 'claude-opus-4-6' });

      const decision = resolveRoute('anthropic', g, credentials);

      expect(decision!.credential.id).toBe('c1');
      expect(decision!.modelOverride).toBe('claude-opus-4-6');
      expect(decision!.translation).toBeUndefined();
      expect(decision!.swap).toBeUndefined();
    });

    it('surfaces modelOverride alongside a credential pin on the same provider', () => {
      const credentials = [cred('c1', 'openai'), cred('c2', 'openai')];
      const g = group('openai', { model: 'gpt-4o', credentialId: 'c2' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c2');
      expect(decision!.modelOverride).toBe('gpt-4o');
    });

    it('does not set modelOverride when the group has no model pinned', () => {
      const credentials = [cred('c1', 'openai')];
      const g = group('openai');

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.modelOverride).toBeUndefined();
    });

    it('does not set modelOverride when no group is set', () => {
      const credentials = [cred('c1', 'openai')];

      const decision = resolveRoute('openai', undefined, credentials);

      expect(decision!.modelOverride).toBeUndefined();
    });
  });

  describe('priority order', () => {
    it('prefers cross-family over same-family when both are possible', () => {
      // This is a fabricated scenario for the rule itself: cross-family
      // has higher precedence in the resolver. In practice, two providers
      // can't be both same-family and cross-family — the rule just exists
      // to define behavior unambiguously.
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.translation).toBeDefined();
      expect(decision!.swap).toBeUndefined();
    });
  });
});

describe('resolveCrossFamilyRoute (direct)', () => {
  it('returns undefined when no group', () => {
    expect(resolveCrossFamilyRoute(undefined, 'openai', [cred('c1', 'anthropic')])).toBeUndefined();
  });

  it('returns undefined when group provider matches request', () => {
    const g = group('openai', { model: 'gpt-4o' });
    expect(resolveCrossFamilyRoute(g, 'openai', [cred('c1', 'openai')])).toBeUndefined();
  });

  it('returns undefined when destination credential is missing', () => {
    const g = group('anthropic', { model: 'claude-sonnet-4-5' });
    expect(resolveCrossFamilyRoute(g, 'openai', [cred('c1', 'openai')])).toBeUndefined();
  });
});

describe('resolveCrossFamilyGiftRoute', () => {
  it('routes openai request through an anthropic gift when group pins it with a model', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_abc' });

    const result = resolveCrossFamilyGiftRoute(g, 'openai', [gc]);

    expect(result).toBeDefined();
    expect(result!.gc.id).toBe('rc1');
    expect(result!.translation).toEqual({
      srcProviderId: 'openai',
      dstProviderId: 'anthropic',
      dstModel: 'claude-sonnet-4-5',
    });
  });

  it('returns undefined when no group is set', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(undefined, 'openai', [gc])).toBeUndefined();
  });

  it('returns undefined when the group provider matches the request', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(g, 'anthropic', [gc])).toBeUndefined();
  });

  it('requires an explicit gift pin on the group (no implicit gift selection)', () => {
    // Gift exists and would otherwise satisfy the route, but without a
    // group.giftId pin we don't reroute through a gift. Cross-family gift
    // routing is opt-in per group.
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', { model: 'claude-sonnet-4-5' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [gc])).toBeUndefined();
  });

  it('returns undefined when the group has no model', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', { giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [gc])).toBeUndefined();
  });

  it('returns undefined when the provider pair is same-family (no translation needed)', () => {
    // Groq and OpenAI are both in the openai family — no translation, so
    // the gift route helper bails out. Same-family swap via gifts is not
    // supported by this helper (it's a translation-specific route).
    const gc = giftedCred('rc1', 'openai', { giftId: 'gift_abc' });
    const g = group('openai', { model: 'gpt-4o', giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(g, 'groq', [gc])).toBeUndefined();
  });

  it('returns undefined when the pinned gift id does not exist', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_other' });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_missing' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [gc])).toBeUndefined();
  });

  it('returns undefined when the pinned gift is expired', () => {
    const gc = giftedCred('rc1', 'anthropic', {
      giftId: 'gift_abc',
      expiresAt: Date.now() - 1000,
    });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [gc])).toBeUndefined();
  });

  it('returns undefined when the pinned gift has exhausted its budget', () => {
    const gc = giftedCred('rc1', 'anthropic', {
      giftId: 'gift_abc',
      usedTokens: 100_000,
      maxTokens: 100_000,
    });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_abc' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [gc])).toBeUndefined();
  });

  it('ignores non-pinned gifts even when they would otherwise match', () => {
    // Two gifts from the destination provider exist in the wallet, but only
    // gift_other is pinned — which happens not to satisfy the route, while
    // the unpinned gift_abc would. The helper must pick by pin, not by
    // heuristic match.
    const pinned = giftedCred('rc1', 'anthropic', {
      giftId: 'gift_other',
      usedTokens: 100_000,
      maxTokens: 100_000,
    });
    const usable = giftedCred('rc2', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', { model: 'claude-sonnet-4-5', giftId: 'gift_other' });
    expect(resolveCrossFamilyGiftRoute(g, 'openai', [pinned, usable])).toBeUndefined();
  });

  it('preserves the exact dstModel from group.model in translation metadata', () => {
    const gc = giftedCred('rc1', 'anthropic', { giftId: 'gift_abc' });
    const g = group('anthropic', {
      model: 'claude-opus-4-6',
      giftId: 'gift_abc',
    });
    const result = resolveCrossFamilyGiftRoute(g, 'openai', [gc]);
    expect(result!.translation.dstModel).toBe('claude-opus-4-6');
  });
});

describe('resolveSameFamilySwapRoute (direct)', () => {
  it('returns undefined when providers are in different families', () => {
    const g = group('anthropic');
    expect(resolveSameFamilySwapRoute(g, 'openai', [cred('c1', 'anthropic')])).toBeUndefined();
  });
});

describe('buildNoCredentialMessage', () => {
  it('points at the missing destination provider when group binds elsewhere', () => {
    const g = group('anthropic');
    const msg = buildNoCredentialMessage('openai', ['openai'], g);
    expect(msg).toContain('No anthropic API key found');
  });

  it('lists existing credentials when wallet has some but not the requested one', () => {
    const msg = buildNoCredentialMessage('anthropic', ['openai', 'gemini'], undefined);
    expect(msg).toContain('You have keys for: openai, gemini');
    expect(msg).toContain('Add a anthropic key');
  });

  it('tells the user the wallet is empty when there are no credentials', () => {
    const msg = buildNoCredentialMessage('openai', [], undefined);
    expect(msg).toContain('No API keys in your wallet');
  });
});

describe('auto cross-family translation', () => {
  function credAt(id: string, providerId: string, lastUsedAt?: number): Credential {
    return { ...cred(id, providerId), lastUsedAt };
  }

  it('auto-translates openai → anthropic when user only has an anthropic key', () => {
    const credentials = [cred('c1', 'anthropic')];

    const decision = resolveRoute('openai', undefined, credentials);

    expect(decision).not.toBeNull();
    expect(decision!.credential.id).toBe('c1');
    expect(decision!.translation).toEqual({
      srcProviderId: 'openai',
      dstProviderId: 'anthropic',
      dstModel: 'claude-sonnet-4-6',
    });
    expect(decision!.swap).toBeUndefined();
  });

  it('auto-translates gemini → openai against the openai flagship', () => {
    const credentials = [cred('c1', 'openai')];

    const decision = resolveRoute('gemini', undefined, credentials);

    expect(decision!.credential.id).toBe('c1');
    expect(decision!.translation?.dstProviderId).toBe('openai');
    expect(decision!.translation?.dstModel).toBe('gpt-5.4');
  });

  it('does not fire when a direct credential exists', () => {
    const credentials = [cred('c1', 'openai'), cred('c2', 'anthropic')];

    const decision = resolveRoute('openai', undefined, credentials);

    expect(decision!.credential.id).toBe('c1');
    expect(decision!.translation).toBeUndefined();
  });

  it('is skipped when a group is set — group cross-family rules still win', () => {
    const credentials = [cred('c1', 'anthropic'), cred('c2', 'gemini')];
    // Group binds gemini without a model → step 1 (cross-family) rejects it
    // for lack of model, step 2 (same-family) rejects it (different family),
    // step 3 (direct) fails (no openai cred). Auto must NOT pick anthropic
    // here — the group explicitly pointed to gemini, and silently routing
    // past the group's intent would overwrite user config.
    const g = group('gemini'); // no model → cross-family disabled

    const decision = resolveRoute('openai', g, credentials);

    expect(decision).toBeNull();
  });

  it('still returns null when group binds to the requested provider and no credential matches', () => {
    const credentials = [cred('c1', 'anthropic')];
    // Group pins openai (=requested) but user holds no openai credential.
    // Auto must not kick in here either — the group's own rules take over.
    const g = group('openai');

    const decision = resolveRoute('openai', g, credentials);

    expect(decision).toBeNull();
  });

  it('picks the most-recently-used candidate across families', () => {
    const credentials = [
      credAt('c1', 'anthropic', 100), // used earlier
      credAt('c2', 'gemini', 500),    // most recent
    ];

    const decision = resolveAutoCrossFamilyRoute('openai', credentials);

    expect(decision!.cred.id).toBe('c2');
    expect(decision!.translation.dstProviderId).toBe('gemini');
  });

  it('tiebreaks by family order (anthropic > openai > gemini > cohere) when no lastUsedAt', () => {
    const credentials = [cred('c1', 'cohere'), cred('c2', 'gemini'), cred('c3', 'anthropic')];

    const decision = resolveAutoCrossFamilyRoute('openai', credentials);

    expect(decision!.cred.id).toBe('c3');
  });

  it('tiebreaks by createdAt desc when lastUsedAt and family are equal', () => {
    const a: Credential = { ...cred('c1', 'anthropic'), createdAt: 100 };
    const b: Credential = { ...cred('c2', 'anthropic'), createdAt: 500 };

    const decision = resolveAutoCrossFamilyRoute('openai', [a, b]);

    expect(decision!.cred.id).toBe('c2');
  });

  it('returns undefined when no held credential is in a translatable family', () => {
    // Unknown provider id → not in any family registry → resolveAutoCrossFamilyRoute skips it.
    const credentials = [cred('c1', 'unknown' as never)];

    const decision = resolveAutoCrossFamilyRoute('openai', credentials);

    expect(decision).toBeUndefined();
  });

  it('returns undefined when the requested provider itself is unknown', () => {
    const credentials = [cred('c1', 'anthropic')];

    const decision = resolveAutoCrossFamilyRoute('unknown' as never, credentials);

    expect(decision).toBeUndefined();
  });
});
