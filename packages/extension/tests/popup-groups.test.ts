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

let view: Mounted | null = null;
const ORIGIN = 'https://chat.example';

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [{ id: 'o1', providerId: 'openai', label: 'Work', authMethod: 'api_key', createdAt: 1 }];
  bg.state.sessions = [{
    id: 's1', sessionKey: 'k', appOrigin: ORIGIN, createdAt: Date.now(), expiresAt: Date.now() + 1e6,
    providers: [{ providerId: 'openai', credentialId: 'o1', available: true, authMethod: 'api_key' }],
  }];
  bg.state.groups = [
    { id: 'default', name: 'Default', providerId: '', createdAt: 1 },
    { id: 'g1', name: 'Cheap', providerId: 'openai', model: 'gpt-5.4-nano', createdAt: 2 },
  ];
  bg.handlers.setAppGroup = (p: { origin: string; groupId: string }) => {
    bg.state.appGroups = { ...bg.state.appGroups, [p.origin]: p.groupId };
    return { success: true };
  };
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

const groupSelect = (c: HTMLElement) => c.querySelector<HTMLSelectElement>(`select[aria-label="Group for ${ORIGIN}"]`);

describe('apps can be moved between groups without drag and drop (F055)', () => {
  it('each app card has a labelled Group select that moves the app', async () => {
    const container = await openConnectedApps();
    const select = groupSelect(container)!;
    expect(select.value).toBe('default');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Default', 'Cheap']);

    typeInto(select, 'g1');
    await run(() => {});

    expect(bg.payloads('setAppGroup')).toEqual([{ origin: ORIGIN, groupId: 'g1' }]);
    expect(groupSelect(container)!.value).toBe('g1');
  });

  it('still asks first when the target group\'s model lacks a feature the app used', async () => {
    bg.state.log = [{
      id: 'l1', sessionId: 's1', appOrigin: ORIGIN, providerId: 'openai', url: 'u', method: 'POST',
      status: 200, timestamp: Date.now(), usedCapabilities: { vision: true },
    }];
    const container = await openConnectedApps();
    typeInto(groupSelect(container)!, 'g1');
    await run(() => {});

    expect(container.textContent).toContain('Capability mismatch.');
    expect(bg.payloads('setAppGroup')).toEqual([]);
    expect(groupSelect(container)!.value).toBe('default');

    await run(() => buttonByText(container, 'Move anyway')!.click());
    expect(bg.payloads('setAppGroup')).toEqual([{ origin: ORIGIN, groupId: 'g1' }]);
  });

  it('shows no select while there is only the default group', async () => {
    bg.state.groups = [{ id: 'default', name: 'Default', providerId: '', createdAt: 1 }];
    const container = await openConnectedApps();
    expect(groupSelect(container)).toBeNull();
  });

  it('pressing the select does not start dragging the card', async () => {
    const container = await openConnectedApps();
    const card = container.querySelector<HTMLElement>('.connected-app-card')!;
    groupSelect(container)!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const drag = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(drag, { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    card.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);

    card.querySelector<HTMLElement>('.card-title')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const drag2 = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.assign(drag2, { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    card.dispatchEvent(drag2);
    expect(drag2.defaultPrevented).toBe(false);
  });
});
