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

  it('refuses a session key used from another origin, without calling upstream', async () => {
    const h = await unlockedWallet();
    const { payload } = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    const r = await h.proxy(OTHER, chat(payload.sessionKey)).result;
    expect(r.error.status).toBe(403);
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

describe('background: password lockout', () => {
  it('locks out after five wrong passwords, also across a worker restart', async () => {
    const local = await walletStorage([]);
    const h = await startBackground({ local });
    for (let i = 0; i < 5; i++) expect((await h.unlock('wrong')).success).toBe(false);
    const locked = await h.unlock(PASSWORD);
    expect(locked.success).toBe(false);
    expect(locked.error).toMatch(/Too many attempts/);
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
