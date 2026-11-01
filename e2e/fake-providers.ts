import type { BrowserContext, Request, Route } from '@playwright/test';

/**
 * Fake Anthropic, OpenAI and Gemini APIs for the default (non-live) e2e run.
 *
 * Playwright's context.route also intercepts the extension service worker's
 * fetches, so the wallet's real proxy path runs unchanged: the request
 * leaves background.ts with the real key injected and lands here. Every
 * other host is blackholed by --host-resolver-rules (fixtures.ts), so a
 * request these routes miss fails instead of reaching a real provider.
 *
 * A request without the key the wallet was given gets the provider's 401.
 */

export type FakeProviderId = 'anthropic' | 'openai' | 'gemini';

export interface FakeKeys {
  anthropic: string;
  openai: string;
  gemini: string;
}

export interface SeenRequest {
  provider: FakeProviderId;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeProviders {
  /** Every request the fakes answered, in order. */
  requests: SeenRequest[];
}

const HOSTS = new Map<string, FakeProviderId>([
  ['api.anthropic.com', 'anthropic'],
  ['api.openai.com', 'openai'],
  ['generativelanguage.googleapis.com', 'gemini'],
]);

const REPLY = 'OK';
const USAGE = { input: 12, output: 2 };

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function sse(route: Route, events: Array<{ event?: string; data: unknown }>): Promise<void> {
  const body = events
    .map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`)
    .join('');
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }, body });
}

function parseBody(request: Request): unknown {
  const raw = request.postData();
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function modelOf(body: unknown, fallback: string): string {
  const model = (body as { model?: unknown } | undefined)?.model;
  return typeof model === 'string' ? model : fallback;
}

/**
 * OpenAI's reasoning models: the o-series and every GPT from 5 on. They
 * answer max_tokens with a 400 and take max_completion_tokens instead.
 */
function isOpenAIReasoningModel(model: string): boolean {
  if (/^o\d/.test(model)) return true;
  const gpt = /^gpt-(\d+)/.exec(model);
  return !!gpt && Number(gpt[1]) >= 5;
}

function wantsStream(body: unknown): boolean {
  return (body as { stream?: unknown } | undefined)?.stream === true;
}

async function anthropic(route: Route, req: SeenRequest, keys: FakeKeys): Promise<void> {
  if (req.headers['x-api-key'] !== keys.anthropic) {
    return json(route, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  }
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST' || path !== '/v1/messages') {
    return json(route, 404, { type: 'error', error: { type: 'not_found_error', message: `fake has no ${req.method} ${path}` } });
  }
  const model = modelOf(req.body, 'claude-haiku-4-5-20251001');
  const id = 'msg_e2e_fake';
  if (!wantsStream(req.body)) {
    return json(route, 200, {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: REPLY }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: USAGE.input, output_tokens: USAGE.output },
    });
  }
  return sse(route, [
    { event: 'message_start', data: { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: USAGE.input, output_tokens: 1 } } } },
    { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
    { event: 'ping', data: { type: 'ping' } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } } },
    { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: USAGE.output } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}

async function openai(route: Route, req: SeenRequest, keys: FakeKeys): Promise<void> {
  if (req.headers['authorization'] !== `Bearer ${keys.openai}`) {
    return json(route, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } });
  }
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST' || path !== '/v1/chat/completions') {
    return json(route, 404, { error: { message: `fake has no ${req.method} ${path}`, type: 'invalid_request_error' } });
  }
  const model = modelOf(req.body, 'gpt-5.4-mini');
  if (isOpenAIReasoningModel(model) && (req.body as { max_tokens?: unknown } | undefined)?.max_tokens !== undefined) {
    // What api.openai.com answers (gpt-5.4-mini, 2026-11-01).
    return json(route, 400, {
      error: {
        message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: 'invalid_request_error',
        param: 'max_tokens',
        code: 'unsupported_parameter',
      },
    });
  }
  const id = 'chatcmpl-e2e-fake';
  const created = Math.floor(Date.now() / 1000);
  const usage = { prompt_tokens: USAGE.input, completion_tokens: USAGE.output, total_tokens: USAGE.input + USAGE.output };
  if (!wantsStream(req.body)) {
    return json(route, 200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }],
      usage,
    });
  }
  const chunk = (delta: unknown, finish: string | null) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] });
  return sse(route, [
    { data: chunk({ role: 'assistant', content: '' }, null) },
    { data: chunk({ content: REPLY }, null) },
    { data: chunk({}, 'stop') },
    { data: { id, object: 'chat.completion.chunk', created, model, choices: [], usage } },
    { data: '[DONE]' },
  ]);
}

async function gemini(route: Route, req: SeenRequest, keys: FakeKeys): Promise<void> {
  if (req.headers['x-goog-api-key'] !== keys.gemini) {
    return json(route, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
  }
  const url = new URL(req.url);
  const action = /^\/v1beta\/models\/([^/:]+):(generateContent|streamGenerateContent)$/.exec(url.pathname);
  if (req.method !== 'POST' || !action) {
    return json(route, 404, { error: { code: 404, message: `fake has no ${req.method} ${url.pathname}`, status: 'NOT_FOUND' } });
  }
  const response = {
    candidates: [{ content: { role: 'model', parts: [{ text: REPLY }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: USAGE.input, candidatesTokenCount: USAGE.output, totalTokenCount: USAGE.input + USAGE.output },
    modelVersion: action[1],
  };
  if (action[2] === 'generateContent') return json(route, 200, response);
  return sse(route, [{ data: response }]);
}

const HANDLERS: Record<FakeProviderId, (route: Route, req: SeenRequest, keys: FakeKeys) => Promise<void>> = {
  anthropic,
  openai,
  gemini,
};

export async function installFakeProviders(ctx: BrowserContext, keys: FakeKeys): Promise<FakeProviders> {
  const fakes: FakeProviders = { requests: [] };
  await ctx.route(
    (url) => url.protocol === 'https:' && HOSTS.has(url.hostname),
    async (route, request) => {
      const provider = HOSTS.get(new URL(request.url()).hostname)!;
      const seen: SeenRequest = {
        provider,
        method: request.method(),
        url: request.url(),
        headers: await request.allHeaders(),
        body: parseBody(request),
      };
      fakes.requests.push(seen);
      await HANDLERS[provider](route, seen, keys);
    },
  );
  return fakes;
}
