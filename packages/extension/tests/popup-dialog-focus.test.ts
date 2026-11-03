// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, buttonByText, deferred, type Mounted } from './helpers/popup-harness';

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
  bg.state.credentials = [{ id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 }];
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

async function press(key: string, shiftKey = false) {
  await run(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

function focusables(dialog: Element) {
  return [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')];
}

async function openAddCredential(container: HTMLElement) {
  const fab = container.querySelector<HTMLButtonElement>('.fab-button')!;
  fab.focus();
  await run(() => fab.click());
  return container.querySelector<HTMLElement>('[role=dialog]')!;
}

describe('dialogs move, keep and give back focus (F125)', () => {
  it('add credential: focus starts on Provider, Tab wraps, Escape returns focus to +', async () => {
    view = await mount(App);
    const { container } = view;
    const dialog = await openAddCredential(container);
    expect(document.activeElement?.id).toBe('provider');

    const items = focusables(dialog);
    items[items.length - 1].focus();
    await press('Tab');
    expect(document.activeElement).toBe(items[0]);
    await press('Tab', true);
    expect(document.activeElement).toBe(items[items.length - 1]);

    // Focus that strayed behind the sheet comes back on the next Tab.
    container.querySelector<HTMLButtonElement>('.nav button')!.focus();
    await press('Tab');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await press('Escape');
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.fab-button'));
  });

  it('usage sheet: focus moves in and goes back to what opened it', async () => {
    view = await mount(App);
    const { container } = view;
    const opener = container.querySelector<HTMLElement>('[aria-label^="View usage for"]')
      ?? container.querySelector<HTMLElement>('.credential-card')!;
    opener.focus();
    await run(() => opener.click());
    const dialog = container.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Personal');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await press('Escape');
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('reset wallet: Cancel takes focus, Escape cancels, but not while resetting', async () => {
    const reply = deferred();
    bg.handlers.resetWallet = () => reply.promise;
    view = await mount(App);
    const { container } = view;
    await run(() => useWalletStore.getState().navigate('settings'));
    const resetButton = buttonByText(container, 'Reset Wallet')!;
    resetButton.focus();
    await run(() => resetButton.click());

    const dialog = container.querySelector('[role=alertdialog]')!;
    expect(document.activeElement).toBe(buttonByText(dialog, 'Cancel'));
    await press('Escape');
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(document.activeElement).toBe(resetButton);

    await run(() => resetButton.click());
    await run(() => buttonByText(container.querySelector('[role=alertdialog]')!, 'Reset')!.click());
    await press('Escape');
    expect(container.querySelector('[role=alertdialog]')).not.toBeNull();
    await run(() => reply.resolve({ success: true }));
  });
});

// F067: the + button opened a one-item menu that sat before it in the page,
// so Tab left the popup instead of reaching "Add credential".
describe('the + button adds a credential itself (F067)', () => {
  it('is named for it and opens the sheet in one press', async () => {
    view = await mount(App);
    const { container } = view;
    const fab = container.querySelector<HTMLButtonElement>('.fab-button')!;
    expect(fab.getAttribute('aria-label')).toBe('Add credential');
    expect(fab.hasAttribute('aria-expanded')).toBe(false);
    expect(container.querySelector('[role=menu]')).toBeNull();
    await run(() => fab.click());
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Add credential');
  });
});

// F067: "Forgot password?" swapped itself for the reset panel, so focus fell
// to the page, and Escape didn't close the panel.
describe('the unlock screen\'s reset panel keeps focus', () => {
  beforeEach(() => { bg.state.unlocked = false; });

  it('focus moves to Cancel, Escape cancels and focus goes back to the password', async () => {
    view = await mount(App);
    const { container } = view;
    const forgot = buttonByText(container, 'Forgot password?')!;
    forgot.focus();
    await run(() => forgot.click());
    expect(container.textContent).toContain('Reset Wallet?');
    expect(document.activeElement).toBe(buttonByText(container, 'Cancel'));

    await press('Escape');
    expect(container.textContent).not.toContain('Reset Wallet?');
    expect(document.activeElement).toBe(container.querySelector('#password'));
    expect(bg.actions()).not.toContain('resetWallet');
  });
});
