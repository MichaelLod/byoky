import { describe, it, expect } from 'vitest';
import {
  resolveRoute,
  resolveCrossFamilyRoute,
  resolveSameFamilySwapRoute,
  resolveAutoCrossFamilyRoute,
  buildNoCredentialMessage,
  autoRouteModelFor,
} from '../src/routing.js';
import { rewriteProxyUrl, familyOf } from '../src/translate/index.js';
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

function group(
  providerId: string,
  opts: { model?: string; credentialId?: string } = {},
): Group {
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

    it('translates against the destination provider\'s routing model when the group has none', () => {
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic'); // no model

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c1');
      expect(decision!.translation).toEqual({
        srcProviderId: 'openai',
        dstProviderId: 'anthropic',
        dstModel: 'claude-sonnet-4-6',
      });
    });

    it('keeps routing a model-less group past the app\'s own key, not around it', () => {
      // The group's provider wins over the app's own key once routing can
      // name a model for it.
      const credentials = [cred('c1', 'anthropic'), cred('c2', 'gemini')];

      const decision = resolveRoute('anthropic', group('gemini'), credentials);

      expect(decision!.credential.id).toBe('c2');
      expect(decision!.translation?.dstModel).toBe('gemini-3.8-flash');
    });

    it('skips cross-family when neither the group nor the provider names a model', () => {
      // DeepSeek has no routing default (it doesn't serve OpenAI's models).
      const credentials = [cred('c1', 'deepseek')];

      expect(resolveRoute('anthropic', group('deepseek'), credentials)).toBeNull();
      // The message names the real problem: the group needs a model.
      expect(buildNoCredentialMessage('anthropic', ['deepseek'], group('deepseek')))
        .toBe("This app's group routes it to deepseek, which needs a model to translate anthropic requests. Set a model on the group.");
    });

    it('prefers pinned credential id over any-of-provider lookup', () => {
      const credentials = [cred('c1', 'anthropic'), cred('c2', 'anthropic')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5', credentialId: 'c2' });

      const decision = resolveRoute('openai', g, credentials);

      expect(decision!.credential.id).toBe('c2');
    });

    it('ignores a pin to another provider\'s key (no cross-provider key send)', () => {
      // A tampered or stale group pins an OpenAI key while binding Anthropic:
      // the OpenAI key must never be sent to Anthropic.
      const credentials = [cred('c1', 'anthropic'), cred('c2', 'openai')];
      const g = group('anthropic', { model: 'claude-sonnet-4-5', credentialId: 'c2' });

      expect(resolveCrossFamilyRoute(g, 'gemini', credentials)).toBeUndefined();
      expect(resolveRoute('gemini', g, credentials)).toBeNull();
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

    it('ignores a pin to another provider\'s key', () => {
      // Group binds Azure but pins a planted record of another provider:
      // the swap must not hand that credential to the Azure destination,
      // and the app's own OpenAI key doesn't stand in for the group (F002).
      const credentials = [cred('c1', 'openai'), { ...cred('planted', 'groq'), encryptedKey: '' }];
      const g = group('azure_openai', { credentialId: 'planted' });

      expect(resolveSameFamilySwapRoute(g, 'openai', credentials)).toBeUndefined();
      expect(resolveRoute('openai', g, credentials)).toBeNull();
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

    it('refuses a same-provider pin that names another provider\'s key', () => {
      const credentials = [cred('c1', 'openai'), cred('c2', 'anthropic')];
      const g = group('openai', { credentialId: 'c2' });

      expect(resolveRoute('openai', g, credentials)).toBeNull();
    });

    it('surfaces modelOverride when same-provider group pins a model', () => {
      // The group is the strongest routing force — its model must override
      // whatever the SDK put in the body. Without this, a user who pinned
      // Opus in the group would still see Sonnet if the app hardcoded it.
      const credentials = [cred('c1', 'anthropic')];
      const g = group('anthropic', { model: 'claude-opus-4-7' });

      const decision = resolveRoute('anthropic', g, credentials);

      expect(decision!.credential.id).toBe('c1');
      expect(decision!.modelOverride).toBe('claude-opus-4-7');
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

describe('a group bound to another provider never falls back to the app\'s own key (F002)', () => {
  const ollama: Credential = { ...cred('ol', 'ollama'), baseUrl: 'http://localhost:11434' };

  it('model-less group whose provider has no routing default', () => {
    const credentials = [cred('a', 'anthropic'), cred('d', 'deepseek')];
    const g = group('deepseek');

    expect(resolveRoute('anthropic', g, credentials)).toBeNull();
    expect(buildNoCredentialMessage('anthropic', ['anthropic', 'deepseek'], g))
      .toBe("This app's group routes it to deepseek, which needs a model to translate anthropic requests. Set a model on the group.");
  });

  it('model-less group bound to a local server', () => {
    expect(resolveRoute('anthropic', group('ollama'), [cred('a', 'anthropic'), ollama])).toBeNull();
  });

  it('group whose local-server key was deleted', () => {
    const g = group('ollama', { model: 'llama3.3' });

    expect(resolveRoute('anthropic', g, [cred('a', 'anthropic')])).toBeNull();
    expect(buildNoCredentialMessage('anthropic', ['anthropic'], g)).toContain('ollama');
    // Same family: the app's OpenAI key doesn't stand in either.
    expect(resolveRoute('openai', g, [cred('o', 'openai')])).toBeNull();
  });

  it('group with a stale pin', () => {
    const g = group('gemini', { credentialId: 'removed' });

    expect(resolveRoute('anthropic', g, [cred('a', 'anthropic'), cred('g', 'gemini')])).toBeNull();
  });

  it('still routes when the group can serve the request', () => {
    const decision = resolveRoute('anthropic', group('ollama', { model: 'llama3.3' }), [cred('a', 'anthropic'), ollama]);
    expect(decision?.credential.id).toBe('ol');
    expect(decision?.translation?.dstModel).toBe('llama3.3');
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

  it('auto-translates for apps in the default group, which binds no provider', () => {
    const credentials = [cred('c1', 'anthropic')];
    const defaultGroup = { id: 'default', name: 'Default', providerId: '', createdAt: 0 } as Group;

    const decision = resolveRoute('openai', defaultGroup, credentials);

    expect(decision?.credential.id).toBe('c1');
    expect(decision?.translation?.dstProviderId).toBe('anthropic');
  });

  it('auto-translates gemini → openai against the openai flagship', () => {
    const credentials = [cred('c1', 'openai')];

    const decision = resolveRoute('gemini', undefined, credentials);

    expect(decision!.credential.id).toBe('c1');
    expect(decision!.translation?.dstProviderId).toBe('openai');
    expect(decision!.translation?.dstModel).toBe('gpt-5.5');
  });

  it('does not fire when a direct credential exists', () => {
    const credentials = [cred('c1', 'openai'), cred('c2', 'anthropic')];

    const decision = resolveRoute('openai', undefined, credentials);

    expect(decision!.credential.id).toBe('c1');
    expect(decision!.translation).toBeUndefined();
  });

  it('is skipped when a group is set — group cross-family rules still win', () => {
    const credentials = [cred('c1', 'anthropic'), cred('c2', 'deepseek')];
    // Group binds deepseek without a model, and routing names none for
    // deepseek → step 1 (cross-family) rejects it, step 2 (same-family)
    // rejects it (different family), step 3 (direct) fails (no gemini cred).
    // Auto must NOT pick anthropic here — the group explicitly pointed to
    // deepseek, and silently routing past the group's intent would
    // overwrite user config.
    const g = group('deepseek');

    const decision = resolveRoute('gemini', g, credentials);

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

describe('autoRouteModelFor (F015)', () => {
  it('names only models each provider serves', () => {
    expect(autoRouteModelFor('anthropic')).toBe('claude-sonnet-4-6');
    expect(autoRouteModelFor('openai')).toBe('gpt-5.5');
    expect(autoRouteModelFor('gemini')).toBe('gemini-3.8-flash');
    expect(autoRouteModelFor('cohere')).toBe('command-a-03-2025');
    expect(autoRouteModelFor('openrouter')).toBe('openai/gpt-5.5');
    for (const id of ['deepseek', 'groq', 'mistral', 'xai', 'together', 'fireworks', 'perplexity', 'azure_openai', 'ollama', 'lm_studio', 'not-real', 'constructor', '__proto__']) {
      expect(autoRouteModelFor(id), id).toBeUndefined();
    }
  });

  it('never sends OpenAI\'s model to DeepSeek or Groq', () => {
    expect(resolveRoute('anthropic', undefined, [cred('d', 'deepseek')])).toBeNull();
    expect(resolveRoute('anthropic', undefined, [cred('g', 'groq')])).toBeNull();
  });

  it('skips a provider without a routing model and picks the next candidate', () => {
    const groq: Credential = { ...cred('g', 'groq'), createdAt: 500 };
    const openai: Credential = { ...cred('o', 'openai'), createdAt: 100 };

    const decision = resolveRoute('anthropic', undefined, [groq, openai]);

    expect(decision!.credential.id).toBe('o');
    expect(decision!.translation?.dstModel).toBe('gpt-5.5');
  });

  it('routes to OpenRouter with its own name for the OpenAI model', () => {
    const decision = resolveAutoCrossFamilyRoute('anthropic', [cred('r', 'openrouter')]);
    expect(decision?.translation.dstModel).toBe('openai/gpt-5.5');
  });
});

describe('local OpenAI-compatible servers (F032)', () => {
  const ollama: Credential = { ...cred('ol', 'ollama'), baseUrl: 'http://localhost:11434' };
  const lmStudio: Credential = { ...cred('lm', 'lm_studio'), baseUrl: 'http://127.0.0.1:1234' };

  it('are in the openai family', () => {
    expect(familyOf('ollama')).toBe('openai');
    expect(familyOf('lm_studio')).toBe('openai');
  });

  it('rewrite onto the credential\'s loopback server only', () => {
    expect(rewriteProxyUrl('ollama', 'llama3.1', false, 'http://localhost:11434'))
      .toBe('http://localhost:11434/v1/chat/completions');
    expect(rewriteProxyUrl('lm_studio', 'qwen', true, 'http://127.0.0.1:1234/'))
      .toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(rewriteProxyUrl('ollama', 'llama3.1', false)).toBeNull();
    expect(rewriteProxyUrl('ollama', 'llama3.1', false, 'http://192.168.1.5:11434')).toBeNull();
  });

  it('take an openai app\'s requests as a same-family swap', () => {
    const decision = resolveRoute('openai', group('ollama', { model: 'llama3.1' }), [ollama, cred('o', 'openai')]);
    expect(decision!.credential.id).toBe('ol');
    expect(decision!.swap).toEqual({ srcProviderId: 'openai', dstProviderId: 'ollama', dstModel: 'llama3.1' });
  });

  it('take an anthropic app\'s requests through translation when the group names a model', () => {
    const decision = resolveRoute('anthropic', group('lm_studio', { model: 'qwen' }), [lmStudio]);
    expect(decision!.credential.id).toBe('lm');
    expect(decision!.translation).toEqual({ srcProviderId: 'anthropic', dstProviderId: 'lm_studio', dstModel: 'qwen' });
    // Without a model there is nothing to translate to.
    expect(resolveRoute('anthropic', group('lm_studio'), [lmStudio])).toBeNull();
  });

  it('are never picked by auto-routing', () => {
    expect(resolveAutoCrossFamilyRoute('anthropic', [ollama, lmStudio])).toBeUndefined();
    expect(resolveRoute('gemini', undefined, [ollama, cred('a', 'anthropic')])!.credential.id).toBe('a');
  });

  it('keep a request meant for them local: auto-routing never sends it to a cloud key', () => {
    const cloud = [cred('a', 'anthropic'), cred('g', 'gemini'), cred('c', 'cohere')];
    for (const local of ['ollama', 'lm_studio']) {
      expect(resolveAutoCrossFamilyRoute(local, cloud)).toBeUndefined();
      expect(resolveRoute(local, undefined, cloud)).toBeNull();
      // The default group binds nothing, so it counts as no group.
      expect(resolveRoute(local, group(''), cloud)).toBeNull();
    }
  });

  it('can still be routed elsewhere by a group the user set', () => {
    const decision = resolveRoute('ollama', group('anthropic'), [cred('a', 'anthropic')]);
    expect(decision!.credential.id).toBe('a');
    expect(decision!.translation).toEqual({
      srcProviderId: 'ollama',
      dstProviderId: 'anthropic',
      dstModel: 'claude-sonnet-4-6',
    });
  });
});
