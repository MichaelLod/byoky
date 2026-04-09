import { describe, it, expect } from 'vitest';
import {
  resolveRoute,
  resolveCrossFamilyRoute,
  resolveSameFamilySwapRoute,
  buildNoCredentialMessage,
} from '../src/routing.js';
import type { Credential, Group } from '../src/types.js';

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

function group(providerId: string, opts: { model?: string; credentialId?: string } = {}): Group {
  return {
    id: 'g1',
    name: 'Test',
    providerId,
    credentialId: opts.credentialId,
    model: opts.model,
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

    it('returns null when no credential matches', () => {
      const credentials = [cred('c1', 'anthropic')];

      const decision = resolveRoute('openai', undefined, credentials);

      expect(decision).toBeNull();
    });

    it('honors group pin to the same provider as requested', () => {
      const credentials = [cred('c1', 'openai'), cred('c2', 'openai')];
      const g = group('openai', { credentialId: 'c2' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c2');
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
    expect(msg).toContain('routes to anthropic');
    expect(msg).toContain('Add a anthropic credential');
  });

  it('lists existing credentials when wallet has some but not the requested one', () => {
    const msg = buildNoCredentialMessage('anthropic', ['openai', 'gemini'], undefined);
    expect(msg).toContain('You have keys for: openai, gemini');
    expect(msg).toContain('add a anthropic key');
  });

  it('tells the user the wallet is empty when there are no credentials', () => {
    const msg = buildNoCredentialMessage('openai', [], undefined);
    expect(msg).toContain('your wallet has no credentials');
  });
});
