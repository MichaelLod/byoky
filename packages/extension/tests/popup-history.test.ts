// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { bg, mount, run, type Mounted } from './helpers/popup-harness';

// F065: History named the provider the app asked for, never the one that
// served a routed request, and no model at all.

type Store = typeof import('../entrypoints/popup/store');
let useWalletStore: Store['useWalletStore'];
let RequestHistory: typeof import('../entrypoints/popup/pages/RequestHistory').RequestHistory;
let initial: ReturnType<Store['useWalletStore']['getState']>;

beforeAll(async () => {
  ({ useWalletStore } = await import('../entrypoints/popup/store'));
  ({ RequestHistory } = await import('../entrypoints/popup/pages/RequestHistory'));
  initial = useWalletStore.getState();
});

let view: Mounted | null = null;
let n = 0;

function entry(fields: Record<string, unknown>) {
  return {
    id: `l${++n}`, sessionId: 's', appOrigin: 'https://app.example', url: 'u', method: 'POST',
    status: 200, timestamp: Date.now() - 60_000, ...fields,
  };
}

beforeEach(() => {
  bg.reset();
  useWalletStore.setState(initial, true);
  document.body.innerHTML = '';
});

afterEach(() => {
  view?.unmount();
  view = null;
});

async function rows(log: Record<string, unknown>[]) {
  view = await mount(RequestHistory);
  await run(() => useWalletStore.setState({ requestLog: log as never }));
  return [...view.container.querySelectorAll('.log-entry')].map((row) => ({
    head: row.querySelector('span')?.textContent,
    route: row.querySelector('.route-indicator')?.getAttribute('title') ?? null,
    meta: row.querySelector('.log-meta')?.textContent?.replace(/ · .*$/s, '') ?? null,
    error: row.querySelector('.log-error')?.textContent ?? null,
  }));
}

describe('History rows', () => {
  it('show where a translated or routed request went, and its model', async () => {
    expect(await rows([
      entry({ providerId: 'openai', actualProviderId: 'anthropic', model: 'gpt-5.4-mini', actualModel: 'claude-sonnet-4-6' }),
      entry({ providerId: 'groq', actualProviderId: 'openai', model: 'llama-3.3-70b-versatile' }),
      entry({ providerId: 'anthropic', model: 'claude-haiku-4-5', actualModel: 'claude-sonnet-5-5' }),
      entry({ providerId: 'gemini', model: 'gemini-2.5-flash' }),
    ])).toEqual([
      { head: 'POST OpenAI → Anthropic', route: 'Translated to Anthropic (claude-sonnet-4-6)', meta: 'gpt-5.4-mini → claude-sonnet-4-6', error: null },
      { head: 'POST Groq → OpenAI', route: 'Routed to OpenAI', meta: 'llama-3.3-70b-versatile', error: null },
      { head: 'POST Anthropic', route: null, meta: 'claude-haiku-4-5 → claude-sonnet-5-5', error: null },
      { head: 'POST Google Gemini', route: null, meta: 'gemini-2.5-flash', error: null },
    ]);
  });

  it('show a refused request with its reason', async () => {
    expect(await rows([
      entry({ providerId: 'anthropic', status: 429, error: 'Token allowance exceeded for https://app.example' }),
    ])).toEqual([
      { head: 'POST Anthropic', route: null, meta: 'https://app.example', error: 'Token allowance exceeded for https://app.example' },
    ]);
  });
});
