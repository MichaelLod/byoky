// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
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

const CONNECTED = 'https://chat.example';
const LIMITED = 'https://limited.example';
const USED = 'https://used.example';

interface Allowances {
  allowances: Array<{ origin: string; totalLimit?: number; providerLimits?: Record<string, number> }>;
  usage: Record<string, Record<string, number>>;
  limitsHold: 'settings' | 'usage' | null;
}
let stored: Allowances;
let view: Mounted | null = null;

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [{ id: 'o1', providerId: 'openai', label: 'Work', authMethod: 'api_key', createdAt: 1 }];
  bg.state.sessions = [{
    id: 's1', sessionKey: 'k', appOrigin: CONNECTED, createdAt: Date.now(), expiresAt: Date.now() + 1e6,
    providers: [{ providerId: 'openai', credentialId: 'o1', available: true, authMethod: 'api_key' }],
  }];
  bg.state.groups = [{ id: 'default', name: 'Default', providerId: '', createdAt: 1 }];
  stored = { allowances: [], usage: { [CONNECTED]: { openai: 1200 } }, limitsHold: null };
  bg.handlers.getAllowances = () => structuredClone(stored);
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

async function openConnectedApps() {
  view = await mount(App);
  await run(() => useWalletStore.getState().navigate('connected-apps'));
  return view.container;
}

/** The card of the app at `origin` (its full origin is shown at the bottom). */
function card(container: HTMLElement, origin: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('.connected-app-card')]
    .find((c) => c.querySelector('.connected-meta')?.textContent === origin);
}

const errors = (container: HTMLElement) => [...container.querySelectorAll('.error')].map((e) => e.textContent);

// R3-02: the background refuses limit and usage edits while the wallet is
// locked (or for an allowance that doesn't parse), and the popup used to
// close the form as if the edit had been saved.
describe('a refused limit or usage edit says why', () => {
  for (const [what, action, button] of [
    ['setting a limit', 'setAllowance', 'Save'],
    ['removing a limit', 'removeAllowance', 'Remove limit'],
    ['resetting usage', 'resetAppUsage', 'Reset usage'],
  ] as const) {
    it(`${what}: the form stays open with the reason, and shows what is stored`, async () => {
      stored.allowances = [{ origin: CONNECTED, totalLimit: 5000 }];
      bg.handlers[action] = () => ({ error: 'Wallet is locked' });
      const container = await openConnectedApps();
      const app = card(container, CONNECTED)!;
      await run(() => buttonByText(app, 'Edit limit')!.click());
      typeInto(app.querySelector<HTMLInputElement>('.allowance-form input')!, '100');
      const refreshes = bg.actions().filter((a) => a === 'getAllowances').length;

      await run(() => buttonByText(app, button)!.click());

      expect(bg.actions()).toContain(action);
      expect(app.querySelector('.allowance-form')).not.toBeNull();
      expect(errors(container)).toEqual(['Wallet is locked']);
      expect(bg.actions().filter((a) => a === 'getAllowances').length).toBeGreaterThan(refreshes);
      expect(app.querySelector('.allowance-limit')?.textContent).toContain('5.0K');

      // Cancel clears it.
      await run(() => buttonByText(app, 'Cancel')!.click());
      expect(app.querySelector('.allowance-form')).toBeNull();
      expect(errors(container)).toEqual([]);
    });
  }

  it('an edit the background takes closes the form', async () => {
    bg.handlers.setAllowance = (p: { allowance: Allowances['allowances'][number] }) => {
      stored.allowances = [p.allowance];
      return { success: true };
    };
    const container = await openConnectedApps();
    const app = card(container, CONNECTED)!;
    await run(() => buttonByText(app, 'Set limit')!.click());
    typeInto(app.querySelector<HTMLInputElement>('.allowance-form input')!, '2000');
    await run(() => buttonByText(app, 'Save')!.click());

    expect(bg.payloads('setAllowance')).toEqual([{ allowance: { origin: CONNECTED, totalLimit: 2000 } }]);
    expect(app.querySelector('.allowance-form')).toBeNull();
    expect(errors(container)).toEqual([]);
    expect(app.querySelector('.allowance-limit')?.textContent).toContain('2.0K');
  });

  it('shows the reason on the page when the app is gone after the refresh', async () => {
    bg.handlers.setAllowance = () => {
      bg.state.sessions = [];
      return { error: 'Wallet is locked' };
    };
    const container = await openConnectedApps();
    await run(() => buttonByText(card(container, CONNECTED)!, 'Set limit')!.click());
    await run(() => buttonByText(card(container, CONNECTED)!, 'Save')!.click());
    expect(card(container, CONNECTED)).toBeUndefined();
    expect(errors(container)).toEqual(['Wallet is locked']);
  });
});

// R3-03: while apps are paused, the notice asks the user to check every
// app's limit and usage before resuming, but only connected apps had a card
// to check it on.
describe('while apps are paused, every app with a limit or usage can be checked', () => {
  beforeEach(() => {
    stored = {
      allowances: [{ origin: LIMITED, totalLimit: 10_000, providerLimits: { anthropic: 4000 } }],
      usage: { [CONNECTED]: { openai: 1200 }, [LIMITED]: { anthropic: 3000 }, [USED]: { gemini: 50 } },
      limitsHold: 'usage',
    };
  });

  it('lists apps that aren\'t connected, with their usage and limit', async () => {
    const container = await openConnectedApps();
    expect(container.textContent).toContain('Apps not connected now');
    const limited = card(container, LIMITED)!;
    expect(limited.querySelector('.allowance-used')?.textContent).toBe('3.0K tokens used');
    expect(limited.querySelector('.allowance-limit')?.textContent).toContain('10.0K');
    expect(card(container, USED)!.querySelector('.allowance-used')?.textContent).toBe('50 tokens used');
    // The connected app keeps its own card, once.
    expect([...container.querySelectorAll('.connected-meta')].map((m) => m.textContent).sort()).toEqual([CONNECTED, LIMITED, USED]);
  });

  it('edits the limit of an app that isn\'t connected, per provider it has a limit or usage for', async () => {
    bg.handlers.setAllowance = (p: { allowance: Allowances['allowances'][number] }) => {
      stored.allowances = [p.allowance];
      return { success: true };
    };
    const container = await openConnectedApps();
    const limited = card(container, LIMITED)!;
    await run(() => buttonByText(limited, 'Edit limit')!.click());
    expect([...limited.querySelectorAll('.allowance-provider-name')].map((n) => n.textContent)).toEqual(['Anthropic']);
    const [total, anthropic] = limited.querySelectorAll<HTMLInputElement>('.allowance-form input');
    expect([total.value, anthropic.value]).toEqual(['10000', '4000']);
    typeInto(total, '3000');
    await run(() => buttonByText(limited, 'Save')!.click());
    expect(bg.payloads('setAllowance')).toEqual([{ allowance: { origin: LIMITED, totalLimit: 3000, providerLimits: { anthropic: 4000 } } }]);
    expect(card(container, LIMITED)!.querySelector('.allowance-limit')?.textContent).toContain('3.0K');

    // Usage only: a limit can be set for the provider it used.
    const used = card(container, USED)!;
    await run(() => buttonByText(used, 'Set limit')!.click());
    expect([...used.querySelectorAll('.allowance-provider-name')].map((n) => n.textContent)).toEqual(['Google Gemini']);
  });

  it('lists them only while apps are paused', async () => {
    stored.limitsHold = null;
    const container = await openConnectedApps();
    expect(container.textContent).not.toContain('Apps not connected now');
    expect(card(container, LIMITED)).toBeUndefined();
    expect(card(container, CONNECTED)).toBeDefined();
  });
});
