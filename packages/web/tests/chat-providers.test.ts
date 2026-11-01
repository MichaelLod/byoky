import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CHAT_ENDPOINTS,
  cohereErrorMessage,
  cohereResponseText,
  cohereStreamText,
} from '../app/components/chat-providers';
import { isAllowedProxyRequest, validateProxyUrl } from '../../core/src/proxy-utils';
import { createStreamTranslator, translateResponse } from '../../core/src/translate/index';

/** The `data:` payloads of an SSE stream, parsed the way /chat and /demo parse them. */
function sseEvents(stream: string): unknown[] {
  return stream
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data));
}

const COHERE_CTX = {
  srcFamily: 'cohere' as const,
  dstFamily: 'openai' as const,
  dstModel: 'gpt-5.5',
  srcModel: 'command-a-03-2025',
  isStreaming: true,
  requestId: 'req-1',
};

describe('CHAT_ENDPOINTS', () => {
  it('covers every provider in the Backend Relay dropdown', () => {
    const source = readFileSync(resolve(__dirname, '../app/demo/components/BackendRelay.tsx'), 'utf8');
    const block = source.slice(source.indexOf('const PROVIDER_NAMES'), source.indexOf('};', source.indexOf('const PROVIDER_NAMES')));
    const ids = [...block.matchAll(/(\w+): '/g)].map((m) => m[1]);
    expect(ids.length).toBe(9);
    for (const id of ids) expect(CHAT_ENDPOINTS[id], id).toBeTruthy();
  });

  it('only holds URLs the wallet forwards', () => {
    for (const [id, base] of Object.entries(CHAT_ENDPOINTS)) {
      const url = id === 'gemini' ? `${base}/gemini-2.5-flash:generateContent` : base;
      expect(validateProxyUrl(id, url), `${id} origin`).toBe(true);
      expect(isAllowedProxyRequest('POST', url), `${id} path`).toBe(true);
    }
  });
});

describe('Cohere v2 helpers', () => {
  it('extract the text of a Cohere stream', () => {
    // An upstream OpenAI stream, translated into what Cohere sends.
    const translator = createStreamTranslator(COHERE_CTX);
    const openaiStream = [
      { id: 'c1', object: 'chat.completion.chunk', model: 'gpt-5.5', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', model: 'gpt-5.5', choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', model: 'gpt-5.5', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    const cohereStream = translator.process(openaiStream) + translator.flush();

    const events = sseEvents(cohereStream);
    expect(events.some((e) => (e as { type?: string }).type === 'content-delta')).toBe(true);
    expect(events.map(cohereStreamText).filter(Boolean).join('')).toBe('Hello world');
    // The OpenAI-shaped extractor the pages used before finds nothing.
    const openaiShaped = events
      .map((e) => (e as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content)
      .filter(Boolean);
    expect(openaiShaped).toEqual([]);
  });

  it('extract the text of a non-streamed Cohere reply', () => {
    const openaiReply = JSON.stringify({
      id: 'c1', object: 'chat.completion', model: 'gpt-5.5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    const cohereReply = JSON.parse(translateResponse({ ...COHERE_CTX, isStreaming: false }, openaiReply));
    expect(cohereResponseText(cohereReply)).toBe('Hello world');
    expect(cohereResponseText({ message: { content: [] } })).toBeUndefined();
    expect(cohereResponseText(null)).toBeUndefined();
  });

  it('ignore stream events without text', () => {
    expect(cohereStreamText({ type: 'message-start', delta: { message: { role: 'assistant' } } })).toBeUndefined();
    expect(cohereStreamText({ type: 'content-delta', delta: { message: { content: { thinking: 'x' } } } })).toBeUndefined();
    expect(cohereStreamText('nope')).toBeUndefined();
  });

  it('read Cohere and wallet error bodies', () => {
    expect(cohereErrorMessage({ message: 'invalid api token' })).toBe('invalid api token');
    expect(cohereErrorMessage({ error: { code: 'QUOTA_EXCEEDED', message: 'Token allowance used up' } })).toBe('Token allowance used up');
    expect(cohereErrorMessage(null)).toBeUndefined();
  });
});
