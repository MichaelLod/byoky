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
  bg.state.credentials = [
    { id: 'c1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 1 },
    { id: 'c2', providerId: 'openai', label: 'Work', authMethod: 'api_key', createdAt: 2 },
  ];
  bg.handlers.removeCredential = (p: { id: string }) => {
    bg.state.credentials = (bg.state.credentials as { id: string }[]).filter((c) => c.id !== p.id);
    return { success: true };
  };
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

/**
 * Press a key on a button as a browser would: the keydown goes through the
 * page's handlers, and unless one of them cancels it, Enter or Space then
 * activates the button.
 */
async function pressOn(el: HTMLElement, key: 'Enter' | ' ') {
  await run(() => {
    el.focus();
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (!ev.defaultPrevented) el.click();
  });
}

const firstCard = (c: HTMLElement) => c.querySelector<HTMLElement>('.credential-card')!;

describe('credential card works from the keyboard (F054)', () => {
  it('Enter on Rename edits the label instead of opening the usage sheet', async () => {
    view = await mount(App);
    const { container } = view;
    await pressOn(firstCard(container).querySelector<HTMLElement>('[aria-label="Rename credential"]')!, 'Enter');
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.querySelector('.credential-label-input')).not.toBeNull();
  });

  it('Space on Rename edits too', async () => {
    view = await mount(App);
    await pressOn(firstCard(view.container).querySelector<HTMLElement>('[aria-label="Rename credential"]')!, ' ');
    expect(view.container.querySelector('[role=dialog]')).toBeNull();
    expect(view.container.querySelector('.credential-label-input')).not.toBeNull();
  });

  it('Enter on Remove, then on the confirm, removes one key', async () => {
    view = await mount(App);
    const { container } = view;
    await pressOn(buttonByText(firstCard(container), 'Remove')!, 'Enter');
    expect(container.querySelector('[role=dialog]')).toBeNull();
    const confirm = [...firstCard(container).querySelectorAll<HTMLButtonElement>('.card-subtitle button')]
      .find((b) => b.textContent === 'Remove')!;
    await pressOn(confirm, 'Enter');
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(container.querySelectorAll('.credential-card')).toHaveLength(1);
    expect(bg.payloads('removeCredential')).toEqual([{ id: 'c1' }]);
  });

  it('a real button opens the usage sheet, and the card is no role=button', async () => {
    view = await mount(App);
    const { container } = view;
    expect(firstCard(container).getAttribute('role')).toBeNull();
    expect(firstCard(container).hasAttribute('tabindex')).toBe(false);
    const open = container.querySelector<HTMLButtonElement>('button[aria-label="View usage for Personal"]')!;
    await pressOn(open, 'Enter');
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Personal');
  });

  it('a mouse click anywhere on the card still opens the sheet', async () => {
    view = await mount(App);
    const { container } = view;
    await run(() => firstCard(container).querySelector<HTMLElement>('.credential-meta')!.click());
    expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Personal');
  });
});
