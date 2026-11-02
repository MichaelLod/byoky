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

// F031: errors are announced (role=alert) and tied to the field they're
// about. A lockout's countdown changes every second, so screen readers get
// a fixed alert instead and, when it ends, one polite status.
describe('unlock errors reach screen readers (F031)', () => {
  beforeEach(() => { bg.state.unlocked = false; });

  const alerts = (c: HTMLElement) => [...c.querySelectorAll('[role=alert]')].map((a) => a.textContent);
  const status = (c: HTMLElement) => [...c.querySelectorAll('[role=status]')].map((s) => s.textContent).join('');

  it('announces a wrong password and marks the field', async () => {
    bg.handlers.unlock = () => ({ success: false, attemptsLeft: 2 });
    view = await mount(App);
    const { container } = view;
    const input = container.querySelector<HTMLInputElement>('#password')!;
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await submitPassword(container, 'wrong');

    expect(alerts(container)).toEqual(['Incorrect password. 2 tries left before a short lockout.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.getAttribute('role')).toBe('alert');
  });

  it('announces a lockout once, with text that does not tick, and says when it is over', async () => {
    bg.handlers.unlock = () => ({
      success: false,
      error: 'Too many attempts. Try again in 60s',
      lockedUntil: Date.now() + 60_000,
    });
    view = await mount(App);
    const { container } = view;
    await submitPassword(container, 'wrong-5');

    expect(alerts(container)).toEqual(['Too many attempts. Try again in about 60 seconds.']);
    // The countdown on screen is hidden from screen readers.
    expect(container.querySelector('.error')?.getAttribute('aria-hidden')).toBe('true');
    const input = container.querySelector<HTMLInputElement>('#password')!;
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent)
      .toBe('Too many attempts. Try again in about 60 seconds.');

    await tick(2_000);
    expect(errorText(container)).toBe('Too many attempts. Try again in 58s');
    expect(alerts(container)).toEqual(['Too many attempts. Try again in about 60 seconds.']);
    expect(status(container)).toBe('');

    await tick(58_000);
    expect(alerts(container)).toEqual([]);
    expect(status(container)).toBe('You can try again now.');
    expect(input.getAttribute('aria-invalid')).toBe('false');

    typeInto(input, 'again');
    await run(() => {});
    expect(status(container)).toBe('');
  });

  it('rounds a long lockout to minutes', async () => {
    bg.handlers.unlock = () => ({ success: false, lockedUntil: Date.now() + 240_000 });
    view = await mount(App);
    await submitPassword(view.container, 'wrong');
    expect(alerts(view.container)).toEqual(['Too many attempts. Try again in about 4 minutes.']);
  });
});
