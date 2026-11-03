// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { bg, mount, run, typeInto, buttonByText, type Mounted } from './helpers/popup-harness';

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
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
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

async function tick(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

function errorText(container: HTMLElement) {
  return container.querySelector('.error')?.textContent ?? null;
}

async function submitPassword(container: HTMLElement, pw: string) {
  typeInto(container.querySelector<HTMLInputElement>('#password')!, pw);
  await run(() => {});
  await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());
}

describe('password lockout in the popup (F118)', () => {
  beforeEach(() => { bg.state.unlocked = false; });

  it('announces the lockout on the failure that starts it and counts it down', async () => {
    bg.handlers.unlock = () => ({
      success: false,
      error: 'Too many attempts. Try again in 60s',
      lockedUntil: Date.now() + 60_000,
      attemptsLeft: 0,
    });
    view = await mount(App);
    const { container } = view;
    await submitPassword(container, 'wrong-5');

    expect(errorText(container)).toBe('Too many attempts. Try again in 60s');
    const button = () => container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button().disabled).toBe(true);

    await tick(5_000);
    expect(errorText(container)).toBe('Too many attempts. Try again in 55s');
    expect(button().disabled).toBe(true);

    await tick(55_000);
    expect(errorText(container)).toBeNull();
    expect(button().disabled).toBe(false);
    expect(useWalletStore.getState().lockedUntil).toBeNull();
  });

  it('formats long lockouts in minutes', async () => {
    bg.handlers.unlock = () => ({
      success: false,
      error: 'Too many attempts. Try again in 240s',
      lockedUntil: Date.now() + 240_000,
    });
    view = await mount(App);
    await submitPassword(view.container, 'wrong');
    expect(errorText(view.container)).toBe('Too many attempts. Try again in 4m 00s');
    await tick(1_000);
    expect(errorText(view.container)).toBe('Too many attempts. Try again in 3m 59s');
  });

  it('warns on the last two tries before the lockout', async () => {
    let left = 3;
    bg.handlers.unlock = () => ({ success: false, attemptsLeft: --left });
    view = await mount(App);
    await submitPassword(view.container, 'wrong-3');
    expect(errorText(view.container)).toBe('Incorrect password. 2 tries left before a short lockout.');
    await submitPassword(view.container, 'wrong-4');
    expect(errorText(view.container)).toBe('Incorrect password. 1 try left before a short lockout.');
  });

  it('keeps plain "Incorrect password" earlier on and from a background without the fields', async () => {
    bg.handlers.unlock = () => ({ success: false, attemptsLeft: 4 });
    view = await mount(App);
    await submitPassword(view.container, 'wrong-1');
    expect(errorText(view.container)).toBe('Incorrect password');
    bg.handlers.unlock = () => ({ success: false });
    await submitPassword(view.container, 'wrong-2');
    expect(errorText(view.container)).toBe('Incorrect password');
  });

  // F052: the countdown started only from an unlock reply, so a wallet view
  // opened during a lockout (the toolbar popup closes on every blur) showed
  // a plain form that the background then refused.
  it('shows a lockout still running when the wallet view opens', async () => {
    bg.handlers.isUnlocked = () => ({ unlocked: false, lockedUntil: Date.now() + 54_000 });
    view = await mount(App);
    const { container } = view;
    const button = () => container.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(errorText(container)).toBe('Too many attempts. Try again in 54s');
    expect(button().disabled).toBe(true);
    await tick(54_000);
    expect(errorText(container)).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('clears a stale error once the user types again', async () => {
    bg.handlers.unlock = () => ({ success: false });
    view = await mount(App);
    await submitPassword(view.container, 'wrong');
    expect(errorText(view.container)).toBe('Incorrect password');
    typeInto(view.container.querySelector<HTMLInputElement>('#password')!, 'wrong2');
    await run(() => {});
    expect(errorText(view.container)).toBeNull();
  });
});

describe('export re-authentication shares the lockout countdown (F118)', () => {
  it('shows a lockout still running when the wallet view opens (F052)', async () => {
    bg.state.credentials = [{ id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
    bg.handlers.isUnlocked = () => ({ unlocked: true, lockedUntil: Date.now() + 30_000 });
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Export backup')!.click());
    expect(errorText(container)).toBe('Too many attempts. Try again in 30s');
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  });

  it('counts the lockout down in the export form', async () => {
    bg.state.credentials = [{ id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
    bg.handlers.exportVault = () => ({
      error: 'Too many attempts. Try again in 60s',
      lockedUntil: Date.now() + 60_000,
    });
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    await run(() => buttonByText(container, 'Export backup')!.click());

    typeInto(container.querySelector<HTMLInputElement>('#export-current-pw')!, 'wrong');
    typeInto(container.querySelector<HTMLInputElement>('#export-pw')!, 'Another-Strong-Pass-42');
    typeInto(container.querySelector<HTMLInputElement>('#export-confirm')!, 'Another-Strong-Pass-42');
    await run(() => {});
    await run(() => container.querySelector<HTMLButtonElement>('button[type=submit]')!.click());

    expect(errorText(container)).toBe('Too many attempts. Try again in 60s');
    await tick(10_000);
    expect(errorText(container)).toBe('Too many attempts. Try again in 50s');
    expect(container.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await tick(50_000);
    expect(errorText(container)).toBeNull();
  });
});
