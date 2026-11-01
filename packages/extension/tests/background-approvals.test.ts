import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  walletPasswordHash,
  connectApproved,
  approveNext,
  senderFor,
  PASSWORD,
  type Harness,
} from './helpers/background-harness';

const APP = 'https://app.example';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function wallet(): Promise<Harness> {
  const h = await startBackground({
    local: await walletStorage([
      { id: 'o1', providerId: 'openai', key: 'sk-o' },
      { id: 'a1', providerId: 'anthropic', key: 'sk-a' },
    ]),
  });
  expect((await h.unlock()).success).toBe(true);
  return h;
}

async function pending(h: Harness): Promise<Array<{ id: string; appOrigin: string; providers: Array<{ id: string; required: boolean }> }>> {
  return (await h.internal('getPendingApprovals')).approvals;
}

const OPENAI = { providers: [{ id: 'openai', required: true }] };
const ANTHROPIC = { providers: [{ id: 'anthropic', required: true }] };

describe('background: concurrent connects from one origin', () => {
  // F081: the second request polled for a session and took "no pending
  // approval and no session" as a rejection, which is also what the gap
  // between taking the approval out of the queue and creating the session
  // looks like.
  it('answers a request waiting on an approval with the session, however slow storage is', async () => {
    const h = await wallet();
    const first = h.connect(APP, OPENAI);
    await h.until(async () => (await pending(h)).length === 1);
    const second = h.connect(APP, OPENAI);
    await h.settle();
    // Slow storage: creating the session takes well over the old 300 ms poll.
    h.local.latency = () => 60;
    const [approval] = await pending(h);
    const approving = h.internal('approveConnect', { approvalId: approval.id, trust: false });
    // A third request arriving while the approval is being applied joins it
    // rather than queueing a second prompt.
    await new Promise((r) => setTimeout(r, 30));
    const third = h.connect(APP, OPENAI);
    expect(await approving).toEqual({ success: true });
    const replies = await Promise.all([first.response, second.response, third.response]);
    for (const r of replies) expect(r.type).toBe('BYOKY_CONNECT_RESPONSE');
    expect(new Set(replies.map((r) => r.payload.sessionKey)).size).toBe(1);
    h.local.latency = () => 0;
    expect(await pending(h)).toHaveLength(0);
    expect((await h.internal('getSessions')).sessions).toHaveLength(1);
  });

  it('rejects the waiting requests with the one they wait on', async () => {
    const h = await wallet();
    const first = h.connect(APP, OPENAI);
    await h.until(async () => (await pending(h)).length === 1);
    const second = h.connect(APP, OPENAI);
    await h.settle();
    const [approval] = await pending(h);
    await h.internal('rejectConnect', { approvalId: approval.id });
    expect((await first.response).payload.code).toBe('USER_REJECTED');
    expect((await second.response).payload.code).toBe('USER_REJECTED');
  });
});

describe('background: an app asking for more providers', () => {
  // F082: connect() returned the existing session whatever it asked for.
  it('asks about the new providers and widens the session, keeping its key', async () => {
    const h = await wallet();
    const first = await connectApproved(h, APP, OPENAI);
    expect(Object.keys(first.payload.providers)).toEqual(['openai']);

    const { response } = h.connect(APP, ANTHROPIC);
    await h.until(async () => (await pending(h)).length === 1, 10_000, 'an approval for the wider set');
    expect((await pending(h))[0].providers).toEqual([
      { id: 'openai', required: false },
      { id: 'anthropic', required: true },
    ]);
    await approveNext(h);
    const widened = await response;
    expect(widened.payload.sessionKey).toBe(first.payload.sessionKey);
    expect(widened.payload.providers).toMatchObject({ openai: { available: true }, anthropic: { available: true } });
    const sessions = (await h.internal('getSessions')).sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].providers.map((p: { providerId: string }) => p.providerId).sort()).toEqual(['anthropic', 'openai']);
  });

  it('reuses the session without a prompt when it covers the request', async () => {
    const h = await wallet();
    const first = await connectApproved(h, APP, { providers: [{ id: 'openai' }, { id: 'anthropic' }] });
    for (const payload of [OPENAI, {}, { providers: [] }, ANTHROPIC]) {
      const reply = await h.connect(APP, payload).response;
      expect(reply.payload.sessionKey).toBe(first.payload.sessionKey);
    }
    // A silent reconnect probe takes the session as it is.
    const probe = await h.connect(APP, { providers: [{ id: 'mistral' }], reconnectOnly: true }).response;
    expect(probe.payload.sessionKey).toBe(first.payload.sessionKey);
    expect(await pending(h)).toHaveLength(0);
  });

  it('reports a requested provider without a key as unavailable on reuse too', async () => {
    const h = await wallet();
    // A provider id outside every family, so auto translation can't serve it.
    const first = await connectApproved(h, APP, { providers: [{ id: 'openai' }, { id: 'no-such-provider' }] });
    expect(first.payload.providers['no-such-provider']).toEqual({ available: false, authMethod: 'api_key' });
    const again = await h.connect(APP, { providers: [{ id: 'no-such-provider' }] }).response;
    expect(again.payload.providers).toEqual(first.payload.providers);
  });
});

describe('background: the popup hears about the approval queue', () => {
  // F052 (backend half): an open view kept showing a request that had
  // timed out or was approved in another view.
  const changes = (h: Harness) => h.broadcasts.filter((m) => m.action === 'approvalsChanged').length;

  it('broadcasts every change to the queue', async () => {
    const h = await wallet();
    const { response } = h.connect(APP, OPENAI);
    await h.until(() => changes(h) === 1, 5_000, 'approvalsChanged on add');
    await approveNext(h);
    await response;
    expect(changes(h)).toBe(2);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const timedOut = h.connect('https://late.example', OPENAI);
    await h.settle();
    expect(changes(h)).toBe(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await timedOut.response).payload.message).toBe('Connection request timed out');
    expect(changes(h)).toBe(4);
  });

  it('tells a locked wallet\'s popup that a request is waiting', async () => {
    const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    h.connect(APP, OPENAI);
    await h.until(() => h.broadcasts.some((m) => m.action === 'newPendingApproval'), 5_000, 'newPendingApproval while locked');
    expect((await pending(h)).map((p) => p.appOrigin)).toEqual([APP]);
  });
});

describe('background: what the popup is told about the wallet', () => {
  it('says when a wrong password starts a lockout, and how many tries are left', async () => {
    const h = await startBackground({ local: await walletStorage([]) });
    expect(await h.unlock('wrong')).toEqual({ success: false, attemptsLeft: 4 });
    for (let i = 0; i < 3; i++) await h.unlock('wrong');
    const fifth = await h.unlock('wrong');
    expect(fifth.success).toBe(false);
    expect(fifth.error).toMatch(/^Too many attempts. Try again in \d+s$/);
    expect(fifth.attemptsLeft).toBe(0);
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());
    const locked = await h.unlock(PASSWORD);
    expect(locked).toMatchObject({ success: false, attemptsLeft: 0, lockedUntil: fifth.lockedUntil });
  });

  it('reports the lockout on the export re-authentication too', async () => {
    const h = await startBackground({ local: await walletStorage([]) });
    await h.unlock();
    for (let i = 0; i < 4; i++) {
      expect(await h.internal('exportVault', { currentPassword: 'wrong', exportPassword: 'x' })).toEqual({ error: 'Incorrect wallet password' });
    }
    const fifth = await h.internal('exportVault', { currentPassword: 'wrong', exportPassword: 'x' });
    expect(fifth.error).toMatch(/Too many attempts/);
    // The export form's countdown reads lockedUntil (WP-B F052).
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());
    const again = await h.internal('exportVault', { currentPassword: 'wrong', exportPassword: 'x' });
    expect(again).toEqual({ error: expect.stringMatching(/Too many attempts/), lockedUntil: fifth.lockedUntil });
  });

  it('tells other views when the wallet is set up or reset', async () => {
    const h = await startBackground({ local: {} });
    expect(await h.internal('setupWallet', { passwordHash: await walletPasswordHash() })).toEqual({ success: true });
    expect(h.broadcasts.filter((m) => m.action === 'sessionChanged')).toHaveLength(1);
    expect(await h.internal('resetWallet')).toEqual({ success: true });
    expect(h.broadcasts.filter((m) => m.action === 'sessionChanged')).toHaveLength(2);
  });

  it('counts popup activity against the idle lock, for extension pages only', async () => {
    const h = await startBackground({ local: await walletStorage([]) });
    await h.unlock();
    const start = Date.now();
    const now = vi.spyOn(Date, 'now');
    const keepalive = () => h.browser.alarms.onAlarm.emit({ name: 'byoky:bridge-keepalive' });

    now.mockReturnValue(start + 19 * 60_000);
    // A page can't keep the wallet open.
    expect(await h.internal('userActivity', undefined, senderFor(APP))).toBeUndefined();
    expect(await h.internal('userActivity')).toEqual({ success: true });
    now.mockReturnValue(start + 21 * 60_000);
    keepalive();
    expect((await h.internal('isUnlocked')).unlocked).toBe(true);
    // Twenty idle minutes after that activity, it locks.
    now.mockReturnValue(start + 39 * 60_000 + 1);
    keepalive();
    expect((await h.internal('isUnlocked')).unlocked).toBe(false);
  });
});
