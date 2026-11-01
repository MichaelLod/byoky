import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  requestLog,
  senderFor,
  type CredentialSpec,
  type FakeNativeConnection,
  type Harness,
} from './helpers/background-harness';

// Pass-through spy, to see the translation context the background builds.
const translateRequestSpy = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@byoky/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@byoky/core')>();
  return {
    ...core,
    translateRequest: (...args: Parameters<typeof core.translateRequest>) => {
      translateRequestSpy.calls.push(args);
      return core.translateRequest(...args);
    },
  };
});

const APP = 'http://localhost:3000';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function group(id: string, providerId: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, providerId, createdAt: 1, ...extra };
}

/** Start the bridge HTTP proxy for a session of APP; returns the bridge's native connection. */
async function startBridge(h: Harness, sessionKey: string): Promise<FakeNativeConnection> {
  h.nativeHost = (msg, conn) => {
    if (msg.type === 'ping') conn.reply({ type: 'pong' });
    if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
  };
  expect(await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).toEqual({ success: true, port: 19280 });
  return h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
}

/** Send one request through the bridge; resolves with the extension's first reply to it. */
async function bridgeRequest(h: Harness, bridge: FakeNativeConnection, sessionKey: string, req: Record<string, unknown>) {
  const requestId = crypto.randomUUID();
  bridge.reply({ type: 'proxy_http', requestId, sessionKey, method: 'POST', headers: {}, body: '{"messages":[]}', ...req });
  await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId), 5_000, 'a reply from the extension');
  return bridge.fromExtension.find((m) => m.requestId === requestId);
}

describe('background: bridge requests for providers without a fixed host', () => {
  // F029: the bridge sends the registry's placeholder host, which the
  // extension then refused against the credential's real one.
  const CUSTOM: CredentialSpec[] = [
    { id: 'az', providerId: 'azure_openai', key: 'az-key', baseUrl: 'https://myres.openai.azure.com' },
    { id: 'ol', providerId: 'ollama', key: '', baseUrl: 'http://localhost:11500' },
  ];

  it('sends a placeholder-host request to the credential\'s own host', async () => {
    const h = await startBackground({ local: await walletStorage(CUSTOM) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'azure_openai' }, { id: 'ollama' }] });
    const bridge = await startBridge(h, payload.sessionKey);
    h.fetch.mockImplementation(async () => jsonResponse({ choices: [] }));

    expect((await bridgeRequest(h, bridge, payload.sessionKey, {
      providerId: 'azure_openai',
      url: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
    })).type).toBe('proxy_http_response_meta');
    expect(h.fetch.mock.calls[0][0]).toBe('https://myres.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21');
    // Logged without the query, at the real host.
    await h.until(() => requestLog(h).length === 1);
    expect(requestLog(h)[0].url).toBe('https://myres.openai.azure.com/openai/deployments/d/chat/completions');

    expect((await bridgeRequest(h, bridge, payload.sessionKey, {
      providerId: 'ollama',
      url: 'http://localhost:11434/v1/chat/completions',
    })).type).toBe('proxy_http_response_meta');
    expect(h.fetch.mock.calls[1][0]).toBe('http://localhost:11500/v1/chat/completions');
  });

  it('still refuses a request naming another host', async () => {
    const h = await startBackground({ local: await walletStorage(CUSTOM) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'azure_openai' }] });
    const bridge = await startBridge(h, payload.sessionKey);
    const reply = await bridgeRequest(h, bridge, payload.sessionKey, {
      providerId: 'azure_openai',
      url: 'https://evil.openai.azure.com/openai/deployments/d/chat/completions',
    });
    expect(reply).toMatchObject({ type: 'proxy_http_error', error: 'Request URL does not match the credential\'s registered base URL' });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('background: routed requests from providers without a fixed host', () => {
  // F033: a routed app calling Azure (or a local server) had its own URL
  // checked against no base URL at all, so it was always refused.
  it('accepts the app\'s own URL for a routed custom-host provider', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }], {
        groups: [group('default', ''), group('g-openai', 'openai', { model: 'gpt-5.5' })],
        appGroups: { [APP]: 'g-openai' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'azure_openai' }] });
    h.fetch.mockImplementation(async () => jsonResponse({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    const r = await h.proxy(APP, {
      sessionKey: payload.sessionKey,
      providerId: 'azure_openai',
      url: 'https://myres.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    }).result;
    expect(r.error).toBeUndefined();
    expect(h.fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    // ...and the log names the key that was used.
    await h.until(() => requestLog(h).length === 1);
    expect(requestLog(h)[0]).toMatchObject({ providerId: 'azure_openai', actualProviderId: 'openai', credentialId: 'o1' });
  });

  it('still refuses a routed URL no credential of that provider could have', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }], {
        groups: [group('default', ''), group('g-openai', 'openai')],
        appGroups: { [APP]: 'g-openai' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'azure_openai' }] });
    const r = await h.proxy(APP, {
      sessionKey: payload.sessionKey,
      providerId: 'azure_openai',
      url: 'http://myres.openai.azure.com/openai/deployments/d/chat/completions',
      body: '{}',
    }).result;
    expect(r.error.error.code).toBe('INVALID_URL');
  });

  it('gives the translation the destination provider', async () => {
    translateRequestSpy.calls.length = 0;
    const h = await startBackground({
      local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }], {
        groups: [group('default', ''), group('g-openai', 'openai', { model: 'gpt-5-mini' })],
        appGroups: { [APP]: 'g-openai' },
      }),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic' }] });
    h.fetch.mockImplementation(async () => jsonResponse({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
    await h.proxy(APP, {
      sessionKey: payload.sessionKey,
      providerId: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      body: JSON.stringify({ model: 'claude-x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    }).result;
    expect(translateRequestSpy.calls[0][0]).toMatchObject({ srcFamily: 'anthropic', dstFamily: 'openai', dstProviderId: 'openai', dstModel: 'gpt-5-mini' });
  });

  it('records the credential on every log entry', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'openai' }] });
    h.fetch.mockImplementation(async () => jsonResponse({ choices: [] }));
    await h.proxy(APP, { sessionKey: payload.sessionKey, providerId: 'openai', url: 'https://api.openai.com/v1/chat/completions', body: '{}' }).result;
    await h.until(() => requestLog(h).length === 1);
    expect(requestLog(h)[0].credentialId).toBe('o1');
  });
});
