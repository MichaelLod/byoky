import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  requestLog,
  type Harness,
} from './helpers/background-harness';

// F001: Chrome stops an MV3 worker 30 s after its last extension event, and
// an open port doesn't count. A request whose upstream took longer, or a
// connect the user didn't answer within 30 s, died with the worker: the app
// got "Extension disconnected", nothing was logged or charged, and Approve
// found nothing. Work like that now holds the worker, which calls an
// extension API every 20 s while it does.

const APP = 'https://app.example';
const OPENAI = { providers: [{ id: 'openai', required: true }] };
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function wallet(): Promise<Harness> {
  const h = await startBackground({ local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
  expect((await h.unlock()).success).toBe(true);
  return h;
}

function chat(sessionKey: string) {
  return {
    sessionKey,
    providerId: 'openai',
    url: OPENAI_URL,
    body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] }),
  };
}

/** The keepalive calls made over `ms` of (fake) time. */
function pingsOver(h: Harness, ms: number): number {
  const before = h.browser.runtime.getPlatformInfo.mock.calls.length;
  vi.advanceTimersByTime(ms);
  return h.browser.runtime.getPlatformInfo.mock.calls.length - before;
}

/** Resolves once the worker is no longer held (bookkeeping after a request takes a few storage writes). */
async function released(h: Harness): Promise<void> {
  await h.until(() => pingsOver(h, 20_000) === 0, 5_000, 'the worker let go');
  expect(pingsOver(h, 60_000)).toBe(0);
}

/** fetch that answers only when the test says so. */
function slowUpstream(h: Harness) {
  let answer: ((r: Response) => void) | undefined;
  let fail: ((e: unknown) => void) | undefined;
  h.fetch.mockImplementation((_url: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    answer = resolve;
    fail = reject;
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  }));
  return {
    started: () => answer !== undefined,
    answer: (r: Response) => answer!(r),
    fail: (e: unknown) => fail!(e),
  };
}

describe('background: holding the worker while work is outstanding (F001)', () => {
  it('keeps the worker running while a proxied request waits on the upstream, and stops after', async () => {
    const h = await wallet();
    const { payload } = await connectApproved(h, APP, OPENAI);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const upstream = slowUpstream(h);

    const { result } = h.proxy(APP, chat(payload.sessionKey));
    await h.until(upstream.started, 5_000, 'the upstream call');
    // Well past the 30 s Chrome gives an idle worker.
    expect(pingsOver(h, 45_000)).toBe(2);

    upstream.answer(jsonResponse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    const res = await result;
    expect(res.meta.status).toBe(200);
    expect(res.done).toBe(true);
    await h.until(() => requestLog(h).length === 1 && requestLog(h)[0].inputTokens === 3, 5_000, 'the logged usage');
    await released(h);
  });

  it('lets go when the request fails or the app cancels it', async () => {
    const h = await wallet();
    const { payload } = await connectApproved(h, APP, OPENAI);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

    let upstream = slowUpstream(h);
    const failed = h.proxy(APP, chat(payload.sessionKey));
    await h.until(upstream.started, 5_000, 'the upstream call');
    upstream.fail(new TypeError('network down'));
    expect((await failed.result).error.error.code).toBe('PROXY_ERROR');
    await released(h);

    upstream = slowUpstream(h);
    const cancelled = h.proxy(APP, chat(payload.sessionKey));
    await h.until(upstream.started, 5_000, 'the upstream call');
    expect(pingsOver(h, 20_000)).toBe(1);
    cancelled.port.close();
    await released(h);
  });

  it('keeps the worker running while a connect waits for the user, until it is answered', async () => {
    const h = await wallet();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { response } = h.connect(APP, OPENAI);
    await h.until(() => h.broadcasts.some((b) => b.action === 'newPendingApproval'), 5_000, 'the prompt');
    expect(pingsOver(h, 45_000)).toBe(2);

    const [approval] = (await h.internal('getPendingApprovals')).approvals;
    await h.internal('rejectConnect', { approvalId: approval.id });
    expect((await response).payload.code).toBe('USER_REJECTED');
    await released(h);
  });

  it('holds once for any number of waiting requests', async () => {
    const h = await wallet();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    h.connect(APP, OPENAI);
    h.connect('https://other.example', OPENAI, { tabId: 2 });
    await h.until(() => h.broadcasts.filter((b) => b.action === 'newPendingApproval').length === 2, 5_000, 'both prompts');
    expect(pingsOver(h, 20_000)).toBe(1);
  });

  it('ignores the content script\'s pings on both kinds of port', async () => {
    const h = await wallet();
    const { payload } = await connectApproved(h, APP, OPENAI);
    h.fetch.mockResolvedValue(jsonResponse({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }));

    // A ping on a request's port neither runs as a request nor gets a reply.
    const proxyPort = h.openPort('byoky-proxy', APP);
    proxyPort.send({ type: 'BYOKY_KEEPALIVE' });
    await h.settle();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(proxyPort.received).toEqual([]);

    // Nor on a connect's port, whose first reply the content script takes as the answer.
    const { port: connectPort, response } = h.connect('https://other.example', OPENAI, { tabId: 2 });
    await h.until(() => h.broadcasts.some((b) => b.action === 'newPendingApproval'), 5_000, 'the prompt');
    connectPort.send({ type: 'BYOKY_KEEPALIVE' });
    await h.settle();
    expect(connectPort.received).toEqual([]);
    const [approval] = (await h.internal('getPendingApprovals')).approvals;
    await h.internal('approveConnect', { approvalId: approval.id, trust: false });
    expect((await response).type).toBe('BYOKY_CONNECT_RESPONSE');

    // The request still goes through when pings come before and after it.
    const { port, result } = h.proxy(APP, chat(payload.sessionKey));
    port.send({ type: 'BYOKY_KEEPALIVE' });
    expect((await result).done).toBe(true);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
});
