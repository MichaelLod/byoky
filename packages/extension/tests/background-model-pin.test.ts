import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startBackground,
  walletStorage,
  jsonResponse,
  connectApproved,
  senderFor,
  type CredentialSpec,
  type FakeNativeConnection,
  type Harness,
} from './helpers/background-harness';

// R3-05: a group pinning another model of the app's own family only had the
// body's `model` replaced, so requests the pinned model rejects (temperature
// or a forced tool choice to Claude Sonnet 5.5, max_tokens to GPT-5.5) went
// out unchanged and came back as 400s.

const APP = 'http://localhost:3000';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const KEYS: CredentialSpec[] = [
  { id: 'a1', providerId: 'anthropic', key: 'sk-ant-REAL' },
  { id: 'o1', providerId: 'openai', key: 'sk-OPENAI' },
  { id: 'g1', providerId: 'groq', key: 'gsk-GROQ' },
  { id: 'gm', providerId: 'gemini', key: 'AIza-GEMINI' },
];

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';

const TOOL = { name: 'get_weather', input_schema: { type: 'object', properties: {} } };
const OPENAI_TOOL = { type: 'function', function: { name: 'get_weather', parameters: { type: 'object', properties: {} } } };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function group(id: string, providerId: string, model: string) {
  return { id, name: id, providerId, model, createdAt: 1 };
}

async function appInGroup(providerId: string, model: string, requested = providerId) {
  const h = await startBackground({
    local: await walletStorage(KEYS, {
      groups: [group('default', '', ''), group('pinned', providerId, model)],
      appGroups: { [APP]: 'pinned' },
    }),
  });
  await h.unlock();
  const reply = await connectApproved(h, APP, { providers: [{ id: requested, required: true }] });
  h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1, prompt_tokens: 1, completion_tokens: 1 } }));
  return { h, sessionKey: reply.payload.sessionKey as string };
}

/** The (url, raw body) of the n-th upstream call. */
function upstream(h: Harness, n = 0) {
  const [url, init] = h.fetch.mock.calls[n] as [string, RequestInit];
  return { url, body: String(init.body) };
}

describe('background: a group\'s pinned model gets that model\'s request rules', () => {
  it('fits an Anthropic app\'s request to claude-sonnet-5-5', async () => {
    const { h, sessionKey } = await appInGroup('anthropic', 'claude-sonnet-5-5');
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'anthropic', url: ANTHROPIC_URL,
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.5, messages: [{ role: 'user', content: 'hi' }],
        tools: [TOOL], tool_choice: { type: 'tool', name: 'get_weather' },
      }),
    }).result;
    expect(r.done).toBe(true);
    const sent = JSON.parse(upstream(h).body);
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent).not.toHaveProperty('temperature');
    expect(sent.tool_choice).toEqual({ type: 'auto' });
    expect(sent.system).toContain('You must call the get_weather tool');
  });

  it('fits an OpenAI app\'s request to gpt-5.5', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-5.5');
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'openai', url: OPENAI_URL,
      body: JSON.stringify({ model: 'gpt-4.1', max_tokens: 64, temperature: 0.5, messages: [{ role: 'user', content: 'hi' }] }),
    }).result;
    expect(r.done).toBe(true);
    const sent = JSON.parse(upstream(h).body);
    expect(sent).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('fits a same-family swap\'s request to the pinned model', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-5.5', 'groq');
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions',
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 64, temperature: 0.5, messages: [] }),
    }).result;
    expect(r.done).toBe(true);
    const call = upstream(h);
    expect(call.url).toBe(OPENAI_URL);
    expect(JSON.parse(call.body)).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, messages: [] });
  });

  it('sends a request that already names the pinned model byte for byte', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-5.5');
    const body = '{ "model": "gpt-5.5", "max_completion_tokens": 64, "temperature": 1, "messages": [] }';
    expect((await h.proxy(APP, { sessionKey, providerId: 'openai', url: OPENAI_URL, body }).result).done).toBe(true);
    expect(upstream(h).body).toBe(body);
  });

  it('only renames the model of a request that is not a chat request', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-5.5');
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'openai', url: 'https://api.openai.com/v1/responses',
      body: JSON.stringify({ model: 'gpt-4.1', max_output_tokens: 64, temperature: 0.5, input: 'hi' }),
    }).result;
    expect(r.done).toBe(true);
    expect(JSON.parse(upstream(h).body)).toEqual({ model: 'gpt-5.5', max_output_tokens: 64, temperature: 0.5, input: 'hi' });
  });

  // R4-03: Gemini takes the model from the URL and ignores a body `model`
  // (live 2026-11-01), so a pin that only set the body did nothing.
  it('names a pinned Gemini model in the URL and leaves the body as sent', async () => {
    const { h, sessionKey } = await appInGroup('gemini', 'gemini-3.8-flash');
    const body = '{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}';
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'gemini', url: `${GEMINI}/gemini-2.5-flash:streamGenerateContent?alt=sse`, body,
    }).result;
    expect(r.done).toBe(true);
    expect(upstream(h)).toEqual({ url: `${GEMINI}/gemini-3.8-flash:streamGenerateContent?alt=sse`, body });
  });

  it('answers a request the pinned model can\'t serve with a clear error, sending nothing', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-6-astra');
    const r = await h.proxy(APP, {
      sessionKey, providerId: 'openai', url: OPENAI_URL,
      body: JSON.stringify({ model: 'gpt-5.5', messages: [], tools: [OPENAI_TOOL] }),
    }).result;
    expect(r.error.status).toBe(400);
    expect(r.error.error.code).toBe('UNSUPPORTED_FEATURE');
    expect(r.error.error.message).toContain('Responses API');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('background: the bridge path fits a pinned model\'s requests too', () => {
  async function startBridge(h: Harness, sessionKey: string): Promise<FakeNativeConnection> {
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
    return h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
  }

  async function bridgeExchange(h: Harness, bridge: FakeNativeConnection, req: Record<string, unknown>) {
    const requestId = crypto.randomUUID();
    bridge.reply({ type: 'proxy_http', requestId, method: 'POST', headers: {}, ...req });
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId
      && (m.type === 'proxy_http_response_done' || m.type === 'proxy_http_error')), 5_000, 'the end of the response');
    return bridge.fromExtension.filter((m) => m.requestId === requestId);
  }

  it('fits the request to the pinned model', async () => {
    const { h, sessionKey } = await appInGroup('anthropic', 'claude-opus-5-5');
    const bridge = await startBridge(h, sessionKey);
    const replies = await bridgeExchange(h, bridge, {
      sessionKey, providerId: 'anthropic', url: ANTHROPIC_URL,
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 4096, top_k: 5, thinking: { type: 'enabled', budget_tokens: 2048 }, messages: [] }),
    });
    expect(replies.at(-1).type).toBe('proxy_http_response_done');
    expect(JSON.parse(upstream(h).body)).toEqual({ model: 'claude-opus-5-5', max_tokens: 4096, thinking: { type: 'adaptive' }, messages: [] });
  });

  it('names a pinned Gemini model in the URL', async () => {
    const { h, sessionKey } = await appInGroup('gemini', 'gemini-3.8-flash');
    const bridge = await startBridge(h, sessionKey);
    const body = '{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}';
    const replies = await bridgeExchange(h, bridge, {
      sessionKey, providerId: 'gemini', url: `${GEMINI}/gemini-2.5-flash:generateContent`, body,
    });
    expect(replies.at(-1).type).toBe('proxy_http_response_done');
    expect(upstream(h)).toEqual({ url: `${GEMINI}/gemini-3.8-flash:generateContent`, body });
  });

  it('answers a request the pinned model can\'t serve with a clear error', async () => {
    const { h, sessionKey } = await appInGroup('openai', 'gpt-6.1-sol');
    const bridge = await startBridge(h, sessionKey);
    const replies = await bridgeExchange(h, bridge, {
      sessionKey, providerId: 'openai', url: OPENAI_URL,
      body: JSON.stringify({ model: 'gpt-5.5', messages: [], tools: [OPENAI_TOOL] }),
    });
    expect(replies.at(-1)).toMatchObject({ type: 'proxy_http_error', status: 400, code: 'UNSUPPORTED_FEATURE' });
    expect(replies.at(-1).error).toContain('gpt-6.1-sol');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

// R4-01: OpenClaw (pi-ai) sends a thinking budget, or thinking turned off,
// to Claude Opus 5.5, its default model, which refuses both with a 400. Its
// users can't change those requests, so the bridge path fits a request to
// the model it names even when no group pins one.
describe('background: the bridge fits a local tool\'s request to the model it names', () => {
  const OPENCLAW_BODY = {
    model: 'claude-opus-5-5', max_tokens: 2048, stream: true, messages: [{ role: 'user', content: 'ready?' }],
    thinking: { type: 'enabled', budget_tokens: 1024, display: 'summarized' },
  };

  async function unpinned(keys: CredentialSpec[]) {
    const h = await startBackground({ local: await walletStorage(keys) });
    await h.unlock();
    const reply = await connectApproved(h, APP, { providers: [{ id: 'anthropic', required: true }] });
    h.fetch.mockImplementation(async () => jsonResponse({ usage: { input_tokens: 1, output_tokens: 1 } }));
    h.nativeHost = (msg, conn) => {
      if (msg.type === 'ping') conn.reply({ type: 'pong' });
      if (msg.type === 'start-proxy') conn.reply({ type: 'proxy-started' });
    };
    const sessionKey = reply.payload.sessionKey as string;
    expect((await h.internal('startBridgeProxy', { sessionKey, port: 19280 }, senderFor(APP))).success).toBe(true);
    const bridge = h.nativeConnections.find((c) => c.fromExtension.some((m) => m.type === 'start-proxy'))!;
    return { h, sessionKey, bridge };
  }

  function send(bridge: FakeNativeConnection, sessionKey: string, body: string) {
    const requestId = crypto.randomUUID();
    bridge.reply({ type: 'proxy_http', requestId, sessionKey, providerId: 'anthropic', url: ANTHROPIC_URL, method: 'POST', headers: {}, body });
    return requestId;
  }

  it('turns OpenClaw\'s thinking budget into adaptive thinking for Opus 5.5', async () => {
    const { h, sessionKey, bridge } = await unpinned([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-REAL' }]);
    send(bridge, sessionKey, JSON.stringify(OPENCLAW_BODY));
    await h.until(() => h.fetch.mock.calls.length === 1, 5_000, 'the upstream call');
    expect(JSON.parse(upstream(h).body)).toEqual({ ...OPENCLAW_BODY, thinking: { type: 'adaptive', display: 'summarized' } });
  });

  it('fits a setup-token request before the bridge sends it', async () => {
    const { h, sessionKey, bridge } = await unpinned([{ id: 'oat', providerId: 'anthropic', key: 'sk-ant-oat01-test', authMethod: 'oauth' }]);
    const requestId = send(bridge, sessionKey, JSON.stringify({ ...OPENCLAW_BODY, thinking: { type: 'disabled' } }));
    await h.until(() => bridge.fromExtension.some((m) => m.requestId === requestId && m.type === 'proxy_direct_fetch'), 5_000, 'the direct fetch');
    const direct = bridge.fromExtension.find((m) => m.requestId === requestId && m.type === 'proxy_direct_fetch')!;
    expect(JSON.parse(direct.body as string)).not.toHaveProperty('thinking');
  });

  it('sends a request that already fits byte for byte', async () => {
    const { h, sessionKey, bridge } = await unpinned([{ id: 'a1', providerId: 'anthropic', key: 'sk-ant-REAL' }]);
    const body = '{ "model": "claude-opus-5-5", "max_tokens": 64, "thinking": { "type": "adaptive" }, "messages": [] }';
    send(bridge, sessionKey, body);
    await h.until(() => h.fetch.mock.calls.length === 1, 5_000, 'the upstream call');
    expect(upstream(h).body).toBe(body);
  });
});
