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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  bg.reset();
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const pings = () => bg.actions().filter((a) => a === 'userActivity').length;
const click = () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
const key = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

describe('wallet activity keeps the idle lock away (F121)', () => {
  it('reports clicks and keys while unlocked, at most every 30 s', async () => {
    view = await mount(App);
    expect(pings()).toBe(0);   // opening the popup and its refreshes don't count

    click();
    expect(pings()).toBe(1);
    key();
    vi.advanceTimersByTime(29_000);
    click();
    expect(pings()).toBe(1);

    vi.advanceTimersByTime(1_000);
    key();
    expect(pings()).toBe(2);
  });

  it('does not report background-triggered refreshes', async () => {
    view = await mount(App);
    await bg.broadcast('usageUpdated');
    await bg.broadcast('sessionChanged');
    expect(pings()).toBe(0);
  });

  it('stays quiet while locked, and stops on lock', async () => {
    bg.state.unlocked = false;
    view = await mount(App);
    click();
    expect(pings()).toBe(0);

    bg.state.unlocked = true;
    bg.handlers.unlock = () => ({ success: true });
    await run(() => useWalletStore.getState().unlock('pw'));
    click();
    expect(pings()).toBe(1);

    bg.handlers.lock = () => ({ success: true });
    await run(() => useWalletStore.getState().lock());
    vi.advanceTimersByTime(60_000);
    click();
    expect(pings()).toBe(1);
  });
});
