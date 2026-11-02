import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  approveNext,
  requestLog,
  senderFor,
  PASSWORD,
  type Harness,
} from './helpers/background-harness';

// Behavioural tests of entrypoints/background.ts: the wallet's security
// boundary, run against the fake browser in helpers/background-harness.ts.

const APP = 'https://app.example';
const OTHER = 'https://other.example';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function unlockedWallet(extra: Record<string, unknown> = {}): Promise<Harness> {
  const h = await startBackground({
    local: await walletStorage([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-1' }], extra),
  });
  expect((await h.unlock()).success).toBe(true);
  return h;
}

function chat(sessionKey: string, extra: Record<string, unknown> = {}) {
  return {
    sessionKey,
    providerId: 'anthropic',
    url: ANTHROPIC_URL,
    body: JSON.stringify({ model: 'claude-x', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] }),
    ...extra,
  };
}

describe('background: approvals', () => {
  it('a rejected connect reaches the app as USER_REJECTED', async () => {
    const h = await unlockedWallet();
    const { response } = h.connect(APP, { providers: [{ id: 'anthropic', required: true }] });
    await h.until(async () => (await h.internal('getPendingApprovals')).approvals.length === 1);
    const [approval] = (await h.internal('getPendingApprovals')).approvals;
    expect(await h.internal('rejectConnect', { approvalId: approval.id })).toEqual({ success: true });
    expect((await response).payload.code).toBe('USER_REJECTED');
    expect((await h.internal('getSessions')).sessions).toHaveLength(0);
  });

  it('a connect nobody answers times out after two minutes', async () => {
    const h = await unlockedWallet();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { response } = h.connect(APP, { providers: [{ id: 'anthropic', required: true }] });
    await h.settle();
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await response).payload).toEqual({ code: 'USER_REJECTED', message: 'Connection request timed out' });
    expect((await h.internal('getPendingApprovals')).approvals).toHaveLength(0);
  });

  it('a revoked trusted site has to be approved again', async () => {
    const h = await unlockedWallet();
    await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] }, true);
    // Trusted: the next connect (after the session is gone) is silent.
    const [session] = (await h.internal('getSessions')).sessions;
    expect(await h.internal('revokeSession', { sessionId: session.id })).toEqual({ success: true });
    const { response } = h.connect(APP, { providers: [{ id: 'anthropic', required: true }] });
    await h.until(async () => (await h.internal('getPendingApprovals')).approvals.length === 1, 10_000, 'held for approval');
    await approveNext(h);
    expect((await response).type).toBe('BYOKY_CONNECT_RESPONSE');
  });
});

describe('background: proxy boundary', () => {
  it('proxies with the stored key and logs the request', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 3, output_tokens: 4 } }));
    const r = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(r.done).toBe(true);
    expect(r.meta.status).toBe(200);
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_URL);
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-1');
    expect(init.redirect).toBe('error');
    await h.until(() => requestLog(h)[0]?.outputTokens === 4, 5_000, 'usage on the log entry');
  });

  // F040: response headers naming the account behind the key let connected
  // apps link one user across sites; the ones SDKs read still pass.
  it('passes on the upstream headers without the ones naming the account', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 3, output_tokens: 4 } }, 200, {
      'anthropic-organization-id': '11111111-2222-3333-4444-555555555555',
      'openai-organization': 'user-victim123',
      'openai-project': 'proj_abc',
      server: 'cloudflare',
      'request-id': 'req_1',
      'x-request-id': 'req_2',
      'retry-after': '3',
      'anthropic-ratelimit-requests-remaining': '9',
      'x-ratelimit-limit-tokens': '30000000',
    }));
    const r = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(r.meta.headers).toEqual({
      'content-type': 'application/json',
      'request-id': 'req_1',
      'x-request-id': 'req_2',
      'retry-after': '3',
      'anthropic-ratelimit-requests-remaining': '9',
      'x-ratelimit-limit-tokens': '30000000',
    });
  });

  it('strips them from a setup-token reply relayed by the bridge too', async () => {
    const h = await startBackground({
      local: await walletStorage([{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-x', authMethod: 'oauth' }]),
    });
    await h.unlock();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'proxy') {
        conn.reply({
          type: 'proxy_response_meta', requestId: msg.requestId, status: 200,
          headers: { 'content-type': 'application/json', 'anthropic-organization-id': 'org-1', 'request-id': 'req_1' },
        });
        conn.reply({ type: 'proxy_response_chunk', requestId: msg.requestId, chunk: '{}' });
        conn.reply({ type: 'proxy_response_done', requestId: msg.requestId });
      }
    };
    const r = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(r.meta.headers).toEqual({ 'content-type': 'application/json', 'request-id': 'req_1' });
  });

  it('refuses a session key used from another origin, without calling upstream', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const r = await h.proxy(OTHER, chat(payload.sessionKey)).result;
    expect(r.error.status).toBe(403);
    // Not PROVIDER_UNAVAILABLE, which tells developers to ask for a key (F083).
    expect(r.error.error.code).toBe('ORIGIN_MISMATCH');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('refuses endpoints outside the inference allowlist', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const r = await h.proxy(APP, chat(payload.sessionKey, { url: 'https://api.anthropic.com/v1/files', method: 'GET' })).result;
    expect(r.error.error.code).toBe('ENDPOINT_NOT_ALLOWED');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('locking revokes every session', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    expect(await h.internal('lock')).toEqual({ success: true });
    const r = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(r.error.error.code).toBe('SESSION_EXPIRED');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('holds the allowance of in-flight requests, and releases it when they end', async () => {
    // Each request may use about 20 (prompt) + 50 (max_tokens) tokens. A
    // request is let through while the app's usage plus holds is under its
    // allowance of 60, so a second one in parallel isn't.
    const h = await unlockedWallet({ tokenAllowances: [{ origin: APP, totalLimit: 60 }] });
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    let releaseFirst!: () => void;
    h.fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));
    }));
    const first = h.proxy(APP, chat(payload.sessionKey));
    await h.until(() => h.fetch.mock.calls.length === 1, 5_000, 'first upstream call');
    const second = await h.proxy(APP, chat(payload.sessionKey)).result;
    expect(second.error.error.code).toBe('QUOTA_EXCEEDED');
    releaseFirst();
    expect((await first.result).done).toBe(true);
    // 2 tokens used; the hold is gone, so another request fits again.
    await h.until(() => (h.local.data.usageTotals as any)?.[APP]?.anthropic === 2, 5_000, 'usage counted');
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));
    expect((await h.proxy(APP, chat(payload.sessionKey)).result).done).toBe(true);
  });
});

describe('background: holds and the idle lock', () => {
  it('releases the allowance hold of a request whose upstream call failed', async () => {
    const h = await unlockedWallet({ tokenAllowances: [{ origin: APP, totalLimit: 60 }] });
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect((await h.proxy(APP, chat(payload.sessionKey)).result).error.error.code).toBe('PROXY_ERROR');
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));
    expect((await h.proxy(APP, chat(payload.sessionKey)).result).done).toBe(true);
  });

  it('a worker restarting after the idle timeout comes back locked, without sessions', async () => {
    const h = await unlockedWallet();
    await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const session: Record<string, unknown> = { ...h.session!.data, _lastActivity: Date.now() - 21 * 60_000 };
    expect(session._mp).toBe(PASSWORD);
    const restarted = await startBackground({ local: h.local.data, session });
    expect((await restarted.internal('isUnlocked')).unlocked).toBe(false);
    expect((await restarted.internal('getSessions')).sessions).toEqual([]);
    expect(restarted.session!.data._mp).toBeUndefined();
    expect(restarted.broadcasts.some((m) => m.action === 'sessionChanged')).toBe(true);
  });

  it('a worker restarting within the idle timeout stays unlocked, with its sessions', async () => {
    const h = await unlockedWallet();
    await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const restarted = await startBackground({ local: h.local.data, session: { ...h.session!.data, _lastActivity: Date.now() - 60_000 } });
    expect((await restarted.internal('isUnlocked')).unlocked).toBe(true);
    expect((await restarted.internal('getSessions')).sessions).toHaveLength(1);
  });
});

describe('background: password lockout', () => {
  it('locks out after five wrong passwords, also across a worker restart', async () => {
    const local = await walletStorage([]);
    const h = await startBackground({ local });
    for (let i = 0; i < 5; i++) expect((await h.unlock('wrong')).success).toBe(false);
    const locked = await h.unlock(PASSWORD);
    expect(locked.success).toBe(false);
    expect(locked.error).toMatch(/Too many attempts/);
    // The first lockout lasts a minute; each failure after it doubles it.
    expect(locked.lockedUntil - Date.now()).toBeGreaterThan(55_000);
    expect(locked.lockedUntil - Date.now()).toBeLessThanOrEqual(60_000);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    const sixth = await h.unlock('wrong');
    expect(sixth.lockedUntil - (now + 61_000)).toBe(120_000);
    vi.restoreAllMocks();
    // A new worker with the same session storage still refuses.
    const restarted = await startBackground({ local, session: h.session!.data });
    expect((await restarted.unlock(PASSWORD)).error).toMatch(/Too many attempts/);
  });

  it('content scripts cannot reach wallet actions', async () => {
    const h = await unlockedWallet();
    for (const action of ['unlock', 'getCredentials', 'getSessions', 'approveConnect', 'exportVault', 'lock']) {
      expect(await h.internal(action, { password: PASSWORD }, senderFor(APP))).toBeUndefined();
    }
  });
});
