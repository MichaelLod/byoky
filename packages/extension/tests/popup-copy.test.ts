// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, buttonByText, type Mounted } from './helpers/popup-harness';

type Store = typeof import('../entrypoints/popup/store');
let useWalletStore: Store['useWalletStore'];
let App: typeof import('../entrypoints/popup/App').default;
let initial: ReturnType<Store['useWalletStore']['getState']>;

beforeAll(async () => {
  ({ useWalletStore } = await import('../entrypoints/popup/store'));
  App = (await import('../entrypoints/popup/App')).default;
  initial = useWalletStore.getState();
});

let view: Mounted | null = null;

beforeEach(() => {
  bg.reset();
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

const logEntry = (id: string, timestamp: number) => ({
  id, sessionId: 's', appOrigin: 'https://app.example', providerId: 'anthropic', url: 'u',
  method: 'POST', status: 200, timestamp,
});

describe('copy and history details (F128)', () => {
  it('history dates entries from earlier days, not just today\'s', async () => {
    const today = Date.now();
    const earlier = new Date('2026-03-14T09:30:00').getTime();
    bg.state.log = [logEntry('l1', today), logEntry('l2', earlier)];
    view = await mount(App);
    await run(() => useWalletStore.getState().navigate('request-history'));
    const metas = [...view.container.querySelectorAll('.log-meta')].map((m) => m.textContent ?? '');
    expect(metas[0]).toContain(new Date(today).toLocaleTimeString());
    expect(metas[0]).not.toContain('2026');
    expect(metas[1]).toContain('2026');
    expect(metas[1]).toContain('14');
  });

  it('says Byoky with a capital B in the empty history', async () => {
    view = await mount(App);
    await run(() => useWalletStore.getState().navigate('request-history'));
    expect(view.container.textContent).toContain('Requests made through Byoky will appear here.');
  });

  it('says Click, not Tap, in the desktop empty wallet', async () => {
    view = await mount(App);
    expect(view.container.textContent).toContain('Click the + button to add a credential.');
  });

  it('records an approval so the status-strip raven nods, but not a failed one', async () => {
    bg.state.approvals = [{ id: 'a1', appOrigin: 'https://app.example', providers: [], timestamp: 1 }];
    bg.handlers.approveConnect = () => ({ success: false, error: 'Approval not found' });
    view = await mount(App);
    await run(() => buttonByText(view!.container, 'Approve')!.click());
    expect(useWalletStore.getState().approvedAt).toBeNull();

    bg.state.approvals = [{ id: 'a2', appOrigin: 'https://app.example', providers: [], timestamp: 1 }];
    bg.handlers.approveConnect = () => {
      bg.state.approvals = [];
      return { success: true };
    };
    await run(() => useWalletStore.getState().refreshData());
    await run(() => buttonByText(view!.container, 'Approve')!.click());
    expect(useWalletStore.getState().approvedAt).not.toBeNull();
    expect(view.container.querySelector('.status-strip svg')).not.toBeNull();
  });
});
