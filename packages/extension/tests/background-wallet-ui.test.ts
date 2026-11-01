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

  it('opens a popup window on Firefox', async () => {
    const h = await startBackground({ firefox: true, local: await walletStorage([{ id: 'o1', providerId: 'openai', key: 'sk-o' }]) });
    await h.unlock();
    h.connect(APP, OPENAI);
    await h.until(() => h.browser.windows.create.mock.calls.length === 1, 5_000, 'a popup window');
  });
});
