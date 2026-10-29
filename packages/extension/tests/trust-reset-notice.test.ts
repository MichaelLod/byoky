// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The popup reaches the background only through runtime messages. This
// stand-in keeps the one thing the notice needs: the stored flag, which the
// background raises when it drops a trust state.
let storedFlag = false;
const sendMessage = vi.fn(async (msg: { action: string }) => {
  switch (msg.action) {
    case 'getTrustedSites':
      return { sites: [], trustReset: storedFlag };
    case 'dismissTrustResetNotice':
      storedFlag = false;
      return { success: true };
    default:
      return {};
  }
});
vi.stubGlobal('browser', { runtime: { sendMessage } });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Store = typeof import('../entrypoints/popup/store');
type Notice = typeof import('../entrypoints/popup/components/TrustResetNotice');
let useWalletStore: Store['useWalletStore'];
let TrustResetNotice: Notice['TrustResetNotice'];

beforeAll(async () => {
  ({ useWalletStore } = await import('../entrypoints/popup/store'));
  ({ TrustResetNotice } = await import('../entrypoints/popup/components/TrustResetNotice'));
});

/** A fresh popup: new store state, notice mounted, first data load done. */
async function openPopup(): Promise<{ root: Root; container: HTMLElement }> {
  useWalletStore.setState({ showTrustResetNotice: false });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(TrustResetNotice));
    await useWalletStore.getState().refreshData();
  });
  return { root, container };
}

function noticeText(container: HTMLElement): string | null {
  return container.querySelector('.notice-warning')?.textContent ?? null;
}

describe('trusted-sites reset notice', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    document.body.innerHTML = '';
  });

  it('shows once after a drop, stays up this session, and not in the next popup', async () => {
    storedFlag = true;
    const first = await openPopup();
    expect(noticeText(first.container)).toContain('Trusted sites were reset');
    expect(noticeText(first.container)).toContain('failed its integrity check');
    // Showing it clears the stored flag...
    expect(storedFlag).toBe(false);
    // ...but later refreshes in the same popup leave it on screen.
    await act(() => useWalletStore.getState().refreshData());
    expect(noticeText(first.container)).not.toBeNull();
    first.root.unmount();

    const second = await openPopup();
    expect(noticeText(second.container)).toBeNull();
    second.root.unmount();
  });

  it('is dismissible', async () => {
    storedFlag = true;
    const { root, container } = await openPopup();
    const dismiss = container.querySelector<HTMLButtonElement>('.notice-dismiss');
    expect(dismiss?.getAttribute('aria-label')).toBe('Dismiss');
    await act(async () => dismiss!.click());
    expect(noticeText(container)).toBeNull();
    expect(useWalletStore.getState().showTrustResetNotice).toBe(false);
    root.unmount();
  });

  it('does not show without a drop', async () => {
    storedFlag = false;
    const { root, container } = await openPopup();
    expect(noticeText(container)).toBeNull();
    expect(sendMessage.mock.calls.map(([m]) => m.action)).not.toContain('dismissTrustResetNotice');
    root.unmount();
  });
});
