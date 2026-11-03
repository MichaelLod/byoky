// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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
let trustedSites: Array<{ origin: string; trustedAt: number; allowedProviders?: string[] }>;

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [{ id: 'o1', providerId: 'openai', label: 'Work', authMethod: 'api_key', createdAt: 1 }];
  bg.state.groups = [{ id: 'default', name: 'Default', providerId: '', createdAt: 1 }];
  trustedSites = [];
  bg.handlers.getTrustedSites = () => ({ sites: structuredClone(trustedSites), trustReset: false });
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

async function openConnectedApps() {
  view = await mount(App);
  await run(() => useWalletStore.getState().navigate('connect'));
  return view.container;
}

describe('trusted sites list (F035)', () => {
  it('flags a plain-http entry and shows its scheme, so it reads apart from the https site', async () => {
    trustedSites = [
      { origin: 'https://chat.example', trustedAt: Date.now(), allowedProviders: ['openai'] },
      { origin: 'http://chat.example', trustedAt: Date.now(), allowedProviders: ['openai'] },
    ];
    const container = await openConnectedApps();
    const cards = [...container.querySelectorAll<HTMLElement>('.card')]
      .filter((c) => c.querySelector('.card-subtitle')?.textContent?.startsWith('Trusted'));
    expect(cards.map((c) => c.querySelector('.card-title')?.textContent)).toEqual(['chat.example', 'http://chat.example']);
    expect(cards[0].querySelector('.result-tag.alarm')).toBeNull();
    expect(cards[1].querySelector('.result-tag.alarm')?.textContent).toBe('Not secure');
    expect(cards[1].textContent).toContain('asks before connecting');
  });
});

/**
 * A form control's accessible name as far as these forms set it: aria-label,
 * else aria-labelledby, else its <label>. Never the placeholder, which is
 * what a screen reader falls back to without one.
 */
function accessibleName(el: Element): string | null {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() || null;
  const labels = (el as HTMLInputElement).labels;
  return labels && labels.length > 0 ? [...labels].map((l) => l.textContent).join(' ').trim() : null;
}

describe('form fields have names, not just placeholders (F064)', () => {
  const ORIGIN = 'https://chat.example';

  beforeEach(() => {
    bg.state.sessions = [{
      id: 's1', sessionKey: 'k', appOrigin: ORIGIN, createdAt: Date.now(), expiresAt: Date.now() + 1e6,
      providers: [
        { providerId: 'openai', credentialId: 'o1', available: true, authMethod: 'api_key' },
        { providerId: 'anthropic', credentialId: 'a1', available: true, authMethod: 'api_key' },
      ],
    }];
    bg.state.credentials = [
      { id: 'o1', providerId: 'openai', label: 'Work', authMethod: 'api_key', createdAt: 1 },
      { id: 'a1', providerId: 'anthropic', label: 'Personal', authMethod: 'api_key', createdAt: 2 },
    ];
    bg.state.groups = [
      { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
      { id: 'g1', name: 'Cheap', providerId: 'openai', createdAt: 2 },
    ];
  });

  it('the group editor, for a new group and an existing one', async () => {
    const container = await openConnectedApps();
    const names = () => [...container.querySelectorAll('.form-group input, .form-group select')].map(accessibleName);
    const expected = ['Group name', 'Provider', 'Credential (optional)', 'Default model (optional)'];
    await run(() => buttonByText(container, '+ New group')!.click());
    expect(names()).toEqual(expected);
    await run(() => buttonByText(container, 'Edit')!.click());
    expect(names()).toEqual(expected);
    // The model field's list and hint are its own.
    const model = container.querySelector<HTMLInputElement>('.form-group input[list]')!;
    expect(document.getElementById(model.getAttribute('list')!)?.tagName).toBe('DATALIST');
    expect(document.getElementById(model.getAttribute('aria-describedby')!)?.textContent).toContain('Leave empty');
  });

  it('the spending limit form names each provider\'s limit', async () => {
    const container = await openConnectedApps();
    await run(() => buttonByText(container, 'Set limit')!.click());
    const form = container.querySelector('.allowance-form')!;
    expect([...form.querySelectorAll('input')].map(accessibleName)).toEqual(['Total token limit', 'OpenAI', 'Anthropic']);
    expect(form.querySelector('fieldset legend')?.textContent).toBe('Per provider');
    expect(form.querySelector('label:not([for])')).toBeNull();
  });

  it('the credential rename field', async () => {
    view = await mount(App);
    const card = [...view.container.querySelectorAll('.credential-card')].find((c) => c.textContent?.includes('Work'))!;
    await run(() => card.querySelector<HTMLButtonElement>('[aria-label="Rename credential"]')!.click());
    expect(accessibleName(card.querySelector('.credential-label-input')!)).toBe('Rename Work');
  });
});

// F063: Disconnect all revoked every session on one click (iOS and Android
// ask first), and group Delete asked with window.confirm, which Firefox
// doesn't show from an extension popup.
describe('destructive actions ask first, inline', () => {
  const session = (id: string, appOrigin: string) => ({
    id, sessionKey: `k-${id}`, appOrigin, createdAt: Date.now(), expiresAt: Date.now() + 1e6,
    providers: [{ providerId: 'openai', credentialId: 'o1', available: true, authMethod: 'api_key' }],
  });
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bg.state.sessions = [session('s1', 'https://one.example'), session('s2', 'https://two.example')];
    bg.handlers.revokeSession = (p: { sessionId: string }) => {
      bg.state.sessions = (bg.state.sessions as Array<{ id: string }>).filter((s) => s.id !== p.sessionId);
      return { success: true };
    };
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  const confirmBox = (c: HTMLElement) => c.querySelector<HTMLElement>('.inline-confirm');

  it('Disconnect all revokes nothing until confirmed', async () => {
    const container = await openConnectedApps();
    const trigger = buttonByText(container, 'Disconnect all')!;
    trigger.focus();
    await run(() => trigger.click());
    expect(bg.payloads('revokeSession')).toEqual([]);
    const box = confirmBox(container)!;
    expect(box.textContent).toContain('Disconnect 2 apps?');
    expect(document.activeElement).toBe(buttonByText(box, 'Cancel'));

    await run(() => buttonByText(box, 'Cancel')!.click());
    expect(confirmBox(container)).toBeNull();
    expect(bg.payloads('revokeSession')).toEqual([]);
    expect(document.activeElement).toBe(trigger);

    await run(() => trigger.click());
    await run(() => buttonByText(confirmBox(container)!, 'Disconnect all')!.click());
    expect(bg.payloads('revokeSession')).toEqual([{ sessionId: 's1' }, { sessionId: 's2' }]);
    expect(confirmBox(container)).toBeNull();
  });

  it('Escape cancels it, and it goes when one app is left', async () => {
    const container = await openConnectedApps();
    await run(() => buttonByText(container, 'Disconnect all')!.click());
    await run(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(confirmBox(container)).toBeNull();

    await run(() => buttonByText(container, 'Disconnect all')!.click());
    // One app disconnects elsewhere: nothing is left to disconnect "all" of.
    bg.state.sessions = [session('s1', 'https://one.example')];
    await bg.broadcast('sessionChanged');
    expect(confirmBox(container)).toBeNull();
    expect(bg.payloads('revokeSession')).toEqual([]);
  });

  it('group Delete asks inline', async () => {
    bg.state.groups = [
      { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
      { id: 'g1', name: 'Cheap', providerId: 'openai', createdAt: 2 },
    ];
    bg.handlers.deleteGroup = () => ({ success: true });
    const container = await openConnectedApps();
    await run(() => buttonByText(container, 'Delete')!.click());
    expect(confirmBox(container)?.textContent).toContain('Delete group \u201cCheap\u201d?');
    await run(() => buttonByText(confirmBox(container)!, 'Cancel')!.click());
    expect(bg.payloads('deleteGroup')).toEqual([]);

    await run(() => buttonByText(container, 'Delete')!.click());
    await run(() => buttonByText(confirmBox(container)!, 'Delete')!.click());
    expect(bg.payloads('deleteGroup')).toEqual([{ id: 'g1' }]);
  });

  it('removing a trusted site asks inline', async () => {
    trustedSites = [{ origin: 'https://chat.example', trustedAt: Date.now(), allowedProviders: ['openai'] }];
    bg.handlers.removeTrustedSite = () => ({ success: true });
    const container = await openConnectedApps();
    await run(() => buttonByText(container, 'Remove')!.click());
    expect(bg.payloads('removeTrustedSite')).toEqual([]);
    expect(confirmBox(container)?.textContent).toContain('Stop trusting chat.example?');
    await run(() => buttonByText(confirmBox(container)!, 'Remove')!.click());
    expect(bg.payloads('removeTrustedSite')).toEqual([{ origin: 'https://chat.example' }]);
  });
});
