// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, typeInto, type Mounted } from './helpers/popup-harness';

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

const req = (id: string, appOrigin: string) => ({ id, appOrigin, providers: [{ id: 'anthropic' }], timestamp: 1 });

function raven(container: HTMLElement) {
  return container.querySelector('.brand-mark svg')?.getAttribute('aria-label');
}

beforeEach(() => {
  bg.reset();
  bg.state.unlocked = false;
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('a locked wallet says an app is waiting (F119)', () => {
  it('names the waiting app and puts the raven on alert', async () => {
    bg.state.approvals = [req('a1', 'http://127.0.0.1:5173')];
    view = await mount(App);
    const { container } = view;
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(container.querySelector('.unlock-pending')?.textContent).toBe(
      '127.0.0.1:5173 wants to connect. Unlock to review.',
    );
    expect(raven(container)).toBe('Muninn the raven, on alert');
    expect(container.querySelector('.pending-pill')?.textContent).toBe('1 pending');
  });

  it('counts further requests', async () => {
    bg.state.approvals = [req('a1', 'https://one.example'), req('a2', 'https://two.example')];
    view = await mount(App);
    expect(view.container.querySelector('.unlock-pending')?.textContent).toBe(
      'one.example wants to connect. Unlock to review. (+1 more)',
    );
  });

  it('stays the plain lock screen when nothing waits', async () => {
    view = await mount(App);
    expect(view.container.querySelector('.unlock-pending')).toBeNull();
    expect(raven(view.container)).toBe('Muninn the raven, watching');
    expect(view.container.querySelector('.pending-pill')).toBeNull();
  });

  it('picks up a request that arrives while the lock screen is open', async () => {
    view = await mount(App);
    bg.state.approvals = [req('a1', 'https://app.example')];
    await bg.broadcast('newPendingApproval');
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(view.container.querySelector('.unlock-pending')?.textContent).toContain('app.example wants to connect');

    bg.state.approvals = [];
    await bg.broadcast('approvalsChanged');
    expect(view.container.querySelector('.unlock-pending')).toBeNull();
  });

  it('goes to the request once the background reports it after the unlock', async () => {
    bg.state.approvals = [req('a1', 'https://app.example')];
    bg.handlers.unlock = () => {
      bg.state.unlocked = true;
      return { success: true };
    };
    view = await mount(App);
    typeInto(view.container.querySelector<HTMLInputElement>('#password')!, 'right');
    await run(() => {});
    await run(() => view!.container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
    // processPendingAfterUnlock approves trusted sites, then reports the rest.
    await bg.broadcast('newPendingApproval');
    expect(useWalletStore.getState().currentPage).toBe('approval');
    expect(view.container.querySelector('.approval-origin')?.textContent).toBe('app.example');
  });

  it('still lists the queue after an auto-lock', async () => {
    bg.state.unlocked = true;
    view = await mount(App);
    bg.state.unlocked = false;
    bg.state.approvals = [req('a1', 'https://app.example')];
    await bg.broadcast('sessionChanged');
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(view.container.querySelector('.unlock-pending')?.textContent).toContain('app.example');
  });
});
