// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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

  it('ignores the setup broadcast its own setup causes', async () => {
    const hold = { release: () => {} };
    bg.handlers.setupWallet = () => {
      bg.state.initialized = true;
      return { success: true };
    };
    bg.handlers.unlock = () => new Promise((resolve) => {
      hold.release = () => {
        bg.state.unlocked = true;
        resolve({ success: true });
      };
    });
    view = await mount(App);
    const setup = useWalletStore.getState().setup('Another-Strong-Pass-42');
    // Hashing the password takes real time; wait for the unlock to be asked.
    await vi.waitFor(() => expect(bg.actions()).toContain('unlock'), { timeout: 4000 });
    // The background announces the new wallet while the unlock still runs.
    await bg.broadcast('sessionChanged');
    expect(useWalletStore.getState().currentPage).toBe('setup');
    expect(bg.actions().filter((a) => a === 'isInitialized')).toHaveLength(1);

    await run(async () => {
      hold.release();
      await setup;
    });
    expect(useWalletStore.getState().currentPage).toBe('dashboard');
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
