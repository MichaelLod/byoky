// @vitest-environment jsdom
// Renders the /chat page's ChatView and the /demo Chat tab against a fake
// session, and checks what they send through the wallet.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ByokySession } from '@byoky/sdk';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ChatViewModule = typeof import('../app/chat/ChatApp');
type DemoChatModule = typeof import('../app/demo/components/Chat');
let ChatView: ChatViewModule['ChatView'];
let DemoChat: DemoChatModule['Chat'];

beforeAll(async () => {
  ({ ChatView } = await import('../app/chat/ChatApp'));
  ({ Chat: DemoChat } = await import('../app/demo/components/Chat'));
});

interface Sent {
  providerId: string;
  url: string;
  body: Record<string, unknown>;
}

const SSE = 'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\ndata: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';

function fakeSession(available: string[], sent: Sent[]): ByokySession {
  const providers: ByokySession['providers'] = {};
  for (const id of ['anthropic', 'openai', 'gemini', 'groq', 'deepseek', 'xai', 'mistral', 'together', 'fireworks', 'perplexity', 'openrouter', 'cohere']) {
    providers[id] = { available: available.includes(id), authMethod: 'api_key' };
  }
  return {
    sessionKey: 'sk_fake_session_0123456789',
    proxyUrl: 'x',
    providers,
    createFetch: (providerId: string) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ providerId, url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }) as typeof fetch,
    listModels: () => Promise.reject(new Error('no models endpoint')),
    createRelay: () => { throw new Error('unused'); },
    disconnect: () => {},
    isConnected: async () => true,
    getUsage: async () => { throw new Error('unused'); },
    onDisconnect: () => () => {},
    onProvidersUpdated: () => () => {},
  } as unknown as ByokySession;
}

let root: Root | null = null;
let container: HTMLElement;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function render(element: ReturnType<typeof createElement>) {
  if (!root) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => { root!.render(element); });
  await settle();
}

const $ = <T extends Element>(sel: string) => container.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string) => [...container.querySelectorAll<T>(sel)];

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function clickSuggestion() {
  const button = $$<HTMLButtonElement>('.suggestion, .chat-suggestion')[0];
  expect(button).toBeTruthy();
  await act(async () => { button.click(); });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

describe('/chat', () => {
  const view = (session: ByokySession) => createElement(ChatView, { session, onDisconnect: () => {} });
  const selects = () => $$<HTMLSelectElement>('.provider-select select');

  // F023: a pick of a model the page dropped went out with every request
  // while the select showed the list's first model.
  it('sends the model the select shows when the saved pick is no longer offered', async () => {
    localStorage.setItem('byoky-chat-models', JSON.stringify({ openai: 'retired-model-x', cohere: 'retired-model-y' }));
    const sent: Sent[] = [];
    await render(view(fakeSession(['openai', 'cohere'], sent)));

    for (const provider of ['openai', 'cohere']) {
      await choose(selects()[0], provider);
      const model = selects()[1];
      expect(model.value).toBe(model.options[0].value);
      await clickSuggestion();
      expect(sent.at(-1)).toMatchObject({ providerId: provider, body: { model: model.value } });
      await act(async () => { $$<HTMLButtonElement>('.header-actions button').find((b) => b.textContent === 'Clear')!.click(); });
    }
    expect(localStorage.getItem('byoky-chat-models')).not.toMatch(/retired-model/);
  });

  it('keeps a saved pick the list still offers', async () => {
    const sent: Sent[] = [];
    await render(view(fakeSession(['openai'], sent)));
    const offered = [...selects()[1].options].map((o) => o.value);
    expect(offered.length).toBeGreaterThan(1);
    await act(async () => { root!.unmount(); });
    root = null;

    localStorage.setItem('byoky-chat-models', JSON.stringify({ openai: offered[1] }));
    await render(view(fakeSession(['openai'], sent)));
    expect(selects()[1].value).toBe(offered[1]);
    await clickSuggestion();
    expect(sent.at(-1)?.body.model).toBe(offered[1]);
  });

  // F024: the other hosts of the OpenAI dialect take max_tokens.
  it('caps the reply with max_completion_tokens on OpenAI only', async () => {
    const sent: Sent[] = [];
    await render(view(fakeSession(['openai', 'mistral', 'groq'], sent)));
    for (const provider of ['openai', 'mistral', 'groq']) {
      await choose(selects()[0], provider);
      await clickSuggestion();
      const body = sent.at(-1)!.body;
      expect(sent.at(-1)!.providerId).toBe(provider);
      if (provider === 'openai') {
        expect(body).toHaveProperty('max_completion_tokens');
        expect(body).not.toHaveProperty('max_tokens');
      } else {
        expect(body).toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('max_completion_tokens');
      }
      await act(async () => { $$<HTMLButtonElement>('.header-actions button').find((b) => b.textContent === 'Clear')!.click(); });
    }
  });

  // F088: with no key the page showed Claude's models and suggestions that
  // all failed, and kept 'anthropic' selected once a key was added.
  it('says the wallet has no keys, and switches to the first key added', async () => {
    const sent: Sent[] = [];
    await render(view(fakeSession([], sent)));
    expect($('.empty-wallet-banner')?.textContent).toMatch(/no API keys/i);
    expect(selects()).toHaveLength(0);
    expect($$('.suggestion')).toHaveLength(0);
    expect($<HTMLInputElement>('.chat-input input[type=text]')!.disabled).toBe(true);
    expect($<HTMLButtonElement>('.btn-send')!.disabled).toBe(true);

    // The wallet reports a new Groq key (ChatApp passes the updated providers down).
    await render(view(fakeSession(['groq'], sent)));
    expect($('.empty-wallet-banner')).toBeNull();
    expect(selects()[0].value).toBe('groq');
    expect(selects()[1].value).toBe(selects()[1].options[0].value);
    await clickSuggestion();
    expect(sent.at(-1)).toMatchObject({ providerId: 'groq', body: { model: selects()[1].value } });
  });

  it('moves off a provider whose key was removed', async () => {
    const sent: Sent[] = [];
    await render(view(fakeSession(['anthropic', 'mistral'], sent)));
    expect(selects()[0].value).toBe('anthropic');
    await render(view(fakeSession(['mistral'], sent)));
    expect(selects()[0].value).toBe('mistral');
    await clickSuggestion();
    expect(sent.at(-1)?.providerId).toBe('mistral');
  });
});

describe('/demo Chat tab', () => {
  const chat = (session: ByokySession) => createElement(DemoChat, { session });
  const selects = () => $$<HTMLSelectElement>('.provider-select select');

  // F024: the request and the code sample both use the provider's field.
  it('caps the reply with max_completion_tokens on OpenAI only, in the request and the sample', async () => {
    const sent: Sent[] = [];
    await render(chat(fakeSession(['openai', 'mistral', 'perplexity'], sent)));
    for (const provider of ['openai', 'mistral', 'perplexity']) {
      await choose(selects()[0], provider);
      await clickSuggestion();
      const body = sent.filter((s) => s.providerId === provider).at(-1)!.body;
      const sample = $('.chat-code-snippet')!.textContent!;
      const field = provider === 'openai' ? 'max_completion_tokens' : 'max_tokens';
      const other = provider === 'openai' ? 'max_tokens' : 'max_completion_tokens';
      expect(body).toHaveProperty(field);
      expect(body).not.toHaveProperty(other);
      expect(sample).toContain(`${field}: 1024`);
      expect(sample).not.toContain(`${other}:`);
      await act(async () => { $$<HTMLButtonElement>('.chat-header-actions button').find((b) => b.textContent === 'Clear')!.click(); });
    }
  });

  // F025: the open code panel took most of a phone screen.
  it('starts with the code collapsed on a phone', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 640px'), media: query, addEventListener() {}, removeEventListener() {} }));
    await render(chat(fakeSession(['anthropic'], [])));
    expect($('.chat-code-snippet')).toBeNull();
    expect($('.chat-code-toggle')!.textContent).toMatch(/show code/i);
  });

  it('starts with the code open on a wider screen', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    await render(chat(fakeSession(['anthropic'], [])));
    expect($('.chat-code-snippet')).not.toBeNull();
  });
});
