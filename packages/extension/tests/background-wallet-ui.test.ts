import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  connectApproved,
  EXTENSION_ORIGIN,
  type Harness,
} from './helpers/background-harness';

// F001: on Chrome a connect never showed the wallet. sidePanel.open() was
// called after several awaits, outside the page's user gesture, so Chrome
// refused it, and the window fallback was never reached.

const APP = 'https://app.example';
const OPENAI = { providers: [{ id: 'openai', required: true }] };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function chromeWallet(): Promise<Harness> {
  const h = await startBackground({ chrome: true, local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
  await h.unlock();
  return h;
}

/** How many sidePanel.open() calls succeeded. */
async function panelsOpened(h: Harness): Promise<number> {
  const results = await Promise.allSettled(h.chrome.sidePanel.open.mock.results.map((r: { value: Promise<void> }) => r.value));
  return results.filter((r) => r.status === 'fulfilled').length;
}

describe('background: showing the wallet for a connect request', () => {
  it('opens the side panel inside the page\'s user gesture', async () => {
    const h = await chromeWallet();
    h.connect(APP, OPENAI, { userGesture: true, tabId: 7 });
    await h.until(async () => (await panelsOpened(h)) === 1, 5_000, 'the side panel');
    expect(h.chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
    await h.until(async () => (await h.internal('getPendingApprovals')).approvals.length === 1);
    await h.settle();
    expect(h.chrome.action.openPopup).not.toHaveBeenCalled();
    expect(h.browser.windows.create).not.toHaveBeenCalled();
  });

  it('falls back to the action popup without a gesture', async () => {
    const h = await chromeWallet();
    h.connect(APP, OPENAI);
    await h.until(() => h.chrome.action.openPopup.mock.calls.length === 1, 5_000, 'the action popup');
    await h.settle();
    expect(await panelsOpened(h)).toBe(0);
    expect(h.browser.windows.create).not.toHaveBeenCalled();
  });

  it('opens a popup window when the action popup can\'t open either', async () => {
    const h = await chromeWallet();
    h.chrome.action.openPopup.mockRejectedValue(new Error('no active window'));
    h.connect(APP, OPENAI);
    await h.until(() => h.browser.windows.create.mock.calls.length === 1, 5_000, 'a popup window');
    expect(h.browser.windows.create.mock.calls[0][0]).toMatchObject({ url: `${EXTENSION_ORIGIN}/popup.html`, type: 'popup' });
  });

  it('opens nothing more when a wallet view is already open', async () => {
    const h = await chromeWallet();
    h.chrome.runtime.getContexts.mockResolvedValue([{ contextType: 'SIDE_PANEL', documentUrl: `${EXTENSION_ORIGIN}/sidepanel.html` }]);
    h.connect(APP, OPENAI);
    await h.until(() => h.chrome.runtime.getContexts.mock.calls.length === 1, 5_000, 'the open-view check');
    await h.settle();
    expect(h.chrome.action.openPopup).not.toHaveBeenCalled();
    expect(h.browser.windows.create).not.toHaveBeenCalled();
  });

  it('opens nothing for a silent reconnect or an app whose session covers the request', async () => {
    const h = await chromeWallet();
    expect((await h.connect(APP, { ...OPENAI, reconnectOnly: true }, { userGesture: true }).response).payload.code).toBe('NO_SESSION');
    await connectApproved(h, APP, OPENAI);
    h.chrome.sidePanel.open.mockClear();
    h.chrome.action.openPopup.mockClear();
    const reply = await h.connect(APP, OPENAI, { userGesture: true }).response;
    expect(reply.type).toBe('BYOKY_CONNECT_RESPONSE');
    await h.settle();
    expect(h.chrome.sidePanel.open).not.toHaveBeenCalled();
    expect(h.chrome.action.openPopup).not.toHaveBeenCalled();
  });

  it('shows nothing for a trusted site that connects without a prompt', async () => {
    const h = await chromeWallet();
    const first = await connectApproved(h, APP, OPENAI, true);
    // The app disconnects itself (no revocation), so its next connect is a
    // trusted one.
    const port = h.openPort('byoky-message', APP);
    port.send({ type: 'BYOKY_DISCONNECT', id: 'd1', payload: { sessionKey: first.payload.sessionKey } });
    await port.waitFor((m) => m.type === 'BYOKY_DISCONNECT_ACK');
    h.chrome.sidePanel.open.mockClear();
    h.chrome.action.openPopup.mockClear();

    for (const userGesture of [true, false]) {
      const reply = await h.connect(APP, OPENAI, { userGesture }).response;
      expect(reply.type).toBe('BYOKY_CONNECT_RESPONSE');
      await h.settle();
      expect(h.chrome.sidePanel.open).not.toHaveBeenCalled();
      expect(h.chrome.action.openPopup).not.toHaveBeenCalled();
      expect(h.browser.windows.create).not.toHaveBeenCalled();
      const p = h.openPort('byoky-message', APP);
      p.send({ type: 'BYOKY_DISCONNECT', id: 'd2', payload: { sessionKey: reply.payload.sessionKey } });
      await p.waitFor((m) => m.type === 'BYOKY_DISCONNECT_ACK');
    }
  });

  it('opens a popup window on Firefox', async () => {
    const h = await startBackground({ firefox: true, local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    h.connect(APP, OPENAI);
    await h.until(() => h.browser.windows.create.mock.calls.length === 1, 5_000, 'a popup window');
  });

  // R2-09: a connect that joined one still being checked against the
  // trusted sites showed the wallet, although both were approved silently
  // (React StrictMode's double connect, two tabs).
  it('shows nothing for concurrent connects of a trusted site', async () => {
    for (const browserKind of ['chrome', 'firefox'] as const) {
      const h = await startBackground({
        [browserKind]: true,
        local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]),
      });
      await h.unlock();
      await trustAndDisconnect(h);
      h.chrome?.sidePanel.open.mockClear();
      h.chrome?.action.openPopup.mockClear();
      h.browser.windows.create.mockClear();

      const replies = await Promise.all([h.connect(APP, OPENAI).response, h.connect(APP, OPENAI).response]);
      for (const r of replies) expect(r.type, browserKind).toBe('BYOKY_CONNECT_RESPONSE');
      await h.settle();
      expect(h.chrome?.sidePanel.open ?? vi.fn()).not.toHaveBeenCalled();
      expect(h.chrome?.action.openPopup ?? vi.fn()).not.toHaveBeenCalled();
      expect(h.browser.windows.create, browserKind).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });

  it('shows the wallet again for a connect joining one that waits for the user', async () => {
    const h = await chromeWallet();
    h.connect(APP, OPENAI);
    await h.until(() => h.chrome.action.openPopup.mock.calls.length === 1, 5_000, 'the action popup');
    // The user closed it; the app asks again.
    h.connect(APP, OPENAI);
    await h.until(() => h.chrome.action.openPopup.mock.calls.length === 2, 5_000, 'the action popup again');
    expect((await h.internal('getPendingApprovals')).approvals).toHaveLength(1);
  });

  // R2-09: the trusted sites the in-gesture check knows about were only
  // read in the worker's own lifetime, so after an MV3 worker restart a
  // trusted site's connect opened the side panel.
  it('knows the trusted sites again after a worker restart', async () => {
    const h = await chromeWallet();
    await trustAndDisconnect(h);
    // Same browser session: the worker restarts with storage.session kept.
    const restarted = await startBackground({ chrome: true, local: h.local.data, session: { ...h.session!.data, _lastActivity: Date.now() } });
    expect((await restarted.internal('isUnlocked')).unlocked).toBe(true);
    const reply = await restarted.connect(APP, OPENAI, { userGesture: true }).response;
    expect(reply.type).toBe('BYOKY_CONNECT_RESPONSE');
    await restarted.settle();
    expect(restarted.chrome.sidePanel.open).not.toHaveBeenCalled();
    expect(restarted.chrome.action.openPopup).not.toHaveBeenCalled();
  });

  it('forgets the trusted sites it knows about when the wallet locks', async () => {
    const h = await chromeWallet();
    await trustAndDisconnect(h);
    await h.settle();
    expect(h.session!.data._silentTrust).toEqual([[APP, ['openai']]]);
    await h.internal('lock');
    await h.settle();
    expect(h.session!.data).not.toHaveProperty('_silentTrust');
  });
});

/** Approve APP for openai as a trusted site, then let it disconnect itself (no revocation). */
async function trustAndDisconnect(h: Harness): Promise<void> {
  const first = await connectApproved(h, APP, OPENAI, true);
  const port = h.openPort('byoky-message', APP);
  port.send({ type: 'BYOKY_DISCONNECT', id: 'd1', payload: { sessionKey: first.payload.sessionKey } });
  await port.waitFor((m) => m.type === 'BYOKY_DISCONNECT_ACK');
}
