// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, type Mounted } from './helpers/popup-harness';

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
  bg.state.initialized = false;
  bg.state.unlocked = false;
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('setup racing another wallet view (F120)', () => {
  it('lands on the unlock screen with an explanation when the wallet was set up elsewhere', async () => {
    bg.handlers.setupWallet = () => ({ error: 'Wallet already initialized' });
    view = await mount(App);
    expect(useWalletStore.getState().currentPage).toBe('setup');

    await run(() => useWalletStore.getState().setup('Another-Strong-Pass-42'));

    const { container } = view;
    expect(container.querySelector('.loading')).toBeNull();
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(container.querySelector('#password')).not.toBeNull();
    expect(container.querySelector('.error')?.textContent).toContain('already set up in another window');
    // Never tried the typed password against the other view's wallet.
    expect(bg.actions()).not.toContain('unlock');
    expect(useWalletStore.getState().submitting).toBe(false);
  });

  it('shows the unlock screen with an error when unlocking right after setup fails', async () => {
    bg.handlers.setupWallet = () => ({ success: true });
    bg.handlers.unlock = () => ({ success: false });
    view = await mount(App);

    await run(() => useWalletStore.getState().setup('Another-Strong-Pass-42'));

    const { container } = view;
    expect(container.querySelector('.loading')).toBeNull();
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(container.querySelector('.error')?.textContent).toContain('could not be unlocked');
  });

  it('leaves the setup screen when another view finishes setup', async () => {
    view = await mount(App);
    expect(useWalletStore.getState().currentPage).toBe('setup');

    bg.state.initialized = true;
    await bg.broadcast('sessionChanged');

    expect(useWalletStore.getState().isInitialized).toBe(true);
    expect(useWalletStore.getState().currentPage).toBe('unlock');
    expect(view.container.querySelector('#password')).not.toBeNull();
  });
});
