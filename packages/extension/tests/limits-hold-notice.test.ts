// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The popup reaches the background only through runtime messages. This
// stand-in keeps what the notice needs: the hold the background reports
// with the allowances, and resuming it.
let storedHold: 'settings' | 'usage' | null = null;
const sendMessage = vi.fn(async (msg: { action: string }) => {
  switch (msg.action) {
    case 'getAllowances':
      return { allowances: [], usage: {}, limitsHold: storedHold };
    case 'resumeApps':
      storedHold = null;
      return { success: true };
    default:
      return {};
  }
});
vi.stubGlobal('browser', { runtime: { sendMessage } });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Store = typeof import('../entrypoints/popup/store');
type Notice = typeof import('../entrypoints/popup/components/LimitsHoldNotice');
let useWalletStore: Store['useWalletStore'];
let LimitsHoldNotice: Notice['LimitsHoldNotice'];

beforeAll(async () => {
  ({ useWalletStore } = await import('../entrypoints/popup/store'));
  ({ LimitsHoldNotice } = await import('../entrypoints/popup/components/LimitsHoldNotice'));
});

async function openPopup(page: 'dashboard' | 'connect' | 'connected-apps' = 'dashboard'): Promise<{ root: Root; container: HTMLElement }> {
  useWalletStore.setState({ isUnlocked: true, limitsHold: null, currentPage: page });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(LimitsHoldNotice));
    await useWalletStore.getState().refreshData();
  });
  return { root, container };
}

function notice(container: HTMLElement) {
  return container.querySelector('.notice-warning');
}

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

describe('apps paused notice', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    document.body.innerHTML = '';
  });

  it('says why apps are paused, and resuming clears it', async () => {
    storedHold = 'settings';
    const { root, container } = await openPopup();
    expect(notice(container)?.textContent).toContain('Apps are paused');
    expect(notice(container)?.textContent).toContain('groups were reset to the default');
    // It stays until resumed: there is no dismiss button.
    expect(container.querySelector('.notice-dismiss')).toBeNull();
    await act(async () => { await useWalletStore.getState().refreshData(); });
    expect(notice(container)).not.toBeNull();

    await act(async () => button(container, 'Resume apps')!.click());
    expect(sendMessage.mock.calls.map(([m]) => m.action)).toContain('resumeApps');
    expect(notice(container)).toBeNull();
    root.unmount();
  });

  it('names the usage totals when they failed, and leads to the limits', async () => {
    storedHold = 'usage';
    const { root, container } = await openPopup();
    expect(notice(container)?.textContent).toContain('usage totals failed their integrity check');
    expect(notice(container)?.textContent).not.toContain('groups were reset');
    await act(async () => button(container, 'Check limits')!.click());
    // F068: the Connect tab, whose Sessions list holds the limits.
    expect(useWalletStore.getState().currentPage).toBe('connect');
    // Already there: no button to go there.
    expect(button(container, 'Check limits')).toBeUndefined();
    root.unmount();
  });

  it('has no Check limits button on the Connect tab it leads to (F068)', async () => {
    storedHold = 'settings';
    for (const page of ['connect', 'connected-apps'] as const) {
      const { root, container } = await openPopup(page);
      expect(notice(container)).not.toBeNull();
      expect(button(container, 'Check limits')).toBeUndefined();
      expect(button(container, 'Resume apps')).toBeDefined();
      root.unmount();
    }
  });

  it('does not show while nothing is paused', async () => {
    storedHold = null;
    const { root, container } = await openPopup();
    expect(notice(container)).toBeNull();
    root.unmount();
  });
});
