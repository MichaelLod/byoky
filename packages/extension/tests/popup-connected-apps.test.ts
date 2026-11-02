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
