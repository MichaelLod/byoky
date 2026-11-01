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
    // Translation anthropic -> openai, with the pin on the Groq key.
    const h = await startBackground({
      local: await walletStorage(KEYS, {
        groups: [group('default', ''), group('g-x', 'openai', { credentialId: 'groq1', model: 'gpt-5.5' })],
        appGroups: { [APP]: 'g-x' },
      }),
    });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    expect(reply.payload.providers.anthropic.available).toBe(false);
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
