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
let n = 0;

function entry(fields: Record<string, unknown>) {
  return {
    id: `l${++n}`, sessionId: 's', appOrigin: 'https://app.example', url: 'u', method: 'POST',
    status: 200, timestamp: Date.now() - 60_000, inputTokens: 1000, outputTokens: 50, ...fields,
  };
}

const key = (id: string, providerId: string, label: string) => ({ id, providerId, label, authMethod: 'api_key', createdAt: 1 });

beforeEach(() => {
  bg.reset();
  bg.state.credentials = [key('a1', 'anthropic', 'Personal'), key('a2', 'anthropic', 'Work (unused)')];
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

/** label → [requests, shared note] as the cards show them. */
function cards(container: HTMLElement) {
  return Object.fromEntries([...container.querySelectorAll('.credential-card')].map((card) => [
    card.querySelector('.card-title')?.textContent,
    [
      card.querySelector('.usage-mini-value')?.textContent,
      card.querySelector('.usage-mini-shared')?.textContent ?? null,
    ],
  ]));
}

describe('each credential card shows its own usage (F127)', () => {
  it('of two keys of one provider, only the used one shows usage', async () => {
    bg.state.log = [
      entry({ providerId: 'anthropic', credentialId: 'a1' }),
      entry({ providerId: 'anthropic', credentialId: 'a1' }),
    ];
    view = await mount(App);
    expect(cards(view.container)).toEqual({
      Personal: ['2', null],
      'Work (unused)': ['0', null],
    });
  });

  it('counts a translated request on the key that served it', async () => {
    bg.state.credentials = [key('a1', 'anthropic', 'Personal'), key('o1', 'openai', 'OpenAI')];
    bg.state.log = [entry({ providerId: 'openai', actualProviderId: 'anthropic', credentialId: 'a1' })];
    view = await mount(App);
    expect(cards(view.container)).toEqual({ Personal: ['1', null], OpenAI: ['0', null] });
  });

  it('pins older entries without a key to a provider\'s only key', async () => {
    bg.state.credentials = [key('a1', 'anthropic', 'Personal'), key('o1', 'openai', 'OpenAI')];
    bg.state.log = [
      entry({ providerId: 'anthropic' }),
      entry({ providerId: 'openai', actualProviderId: 'anthropic' }),
    ];
    view = await mount(App);
    expect(cards(view.container)).toEqual({ Personal: ['2', null], OpenAI: ['0', null] });
  });

  it('marks older entries it cannot pin as shared by all of that provider\'s keys', async () => {
    bg.state.log = [entry({ providerId: 'anthropic' }), entry({ providerId: 'anthropic', credentialId: 'a2' })];
    view = await mount(App);
    expect(cards(view.container)).toEqual({
      Personal: ['0', '+1 earlier, all Anthropic keys'],
      'Work (unused)': ['1', '+1 earlier, all Anthropic keys'],
    });
  });

  it('the usage sheet counts only that key', async () => {
    bg.state.log = [
      entry({ providerId: 'anthropic', credentialId: 'a1', model: 'claude-sonnet-4-5' }),
      entry({ providerId: 'anthropic', credentialId: 'a2', model: 'claude-haiku-4-5' }),
      entry({ providerId: 'anthropic' }),
    ];
    view = await mount(App);
    const { container } = view;
    await run(() => container.querySelector<HTMLButtonElement>('button[aria-label="View usage for Personal"]')!.click());
    const sheet = container.querySelector('[role=dialog]')!;
    expect(sheet.querySelector('.usage-stat-value')?.textContent).toBe('1');
    expect(sheet.textContent).toContain('Anthropic · this key only');
    expect(sheet.textContent).toContain('Not counted: 1 earlier request, shared by all Anthropic keys.');
    expect(sheet.textContent).toContain('claude-sonnet-4-5');
    expect(sheet.textContent).not.toContain('claude-haiku-4-5');
  });
});
