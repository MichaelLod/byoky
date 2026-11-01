import { describe, it, expect } from 'vitest';
import { translateErrorResponse, getAdapter, isIRError } from '../../src/translate/index.js';
import type { TranslationContext } from '../../src/translate/types.js';
import type { ModelFamily } from '../../src/models.js';

const FAMILIES: ModelFamily[] = ['anthropic', 'openai', 'gemini', 'cohere'];

function ctx(src: ModelFamily, dst: ModelFamily): TranslationContext {
  return { srcFamily: src, dstFamily: dst, srcModel: 'src-model', dstModel: 'dst-model', isStreaming: false, requestId: 'r1' };
}

/** A 401 error body in each destination dialect. */
const ERROR_BODIES: Record<ModelFamily, string> = {
  anthropic: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
  openai: JSON.stringify({
    error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' },
  }),
  gemini: JSON.stringify({ error: { code: 401, message: 'API key not valid', status: 'UNAUTHENTICATED' } }),
  cohere: JSON.stringify({ id: 'x', message: 'invalid api token' }),
};

const MESSAGES: Record<ModelFamily, string> = {
  anthropic: 'invalid x-api-key',
  openai: 'Incorrect API key provided',
  gemini: 'API key not valid',
  cohere: 'invalid api token',
};

describe('translateErrorResponse — every dialect pair', () => {
  for (const src of FAMILIES) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`${dst} error → ${src} app`, () => {
        const out = translateErrorResponse(ctx(src, dst), ERROR_BODIES[dst]);
        expect(out).not.toBeNull();
        // The app's own adapter reads it back as an error with the message.
        const ir = getAdapter(src).parseResponse(out!);
        expect(isIRError(ir)).toBe(true);
        if (isIRError(ir)) expect(ir.error.message).toBe(MESSAGES[dst]);
      });
    }
  }
});

describe('translateErrorResponse — bodies that are not errors', () => {
  it('returns null for an HTML 502 page', () => {
    expect(translateErrorResponse(ctx('anthropic', 'openai'), '<html><body>502 Bad Gateway</body></html>')).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(translateErrorResponse(ctx('openai', 'gemini'), '')).toBeNull();
  });

  it('returns null for a body that parses as a success', () => {
    const ok = JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] });
    expect(translateErrorResponse(ctx('anthropic', 'openai'), ok)).toBeNull();
  });
});

describe('OpenAI-family error shapes from other hosts', () => {
  const toAnthropic = (body: unknown) =>
    JSON.parse(translateErrorResponse(ctx('anthropic', 'openai'), JSON.stringify(body)) ?? 'null');

  it('xAI: error as a string with a top-level code', () => {
    expect(
      toAnthropic({ code: 'Client specified an invalid argument', error: 'Incorrect API key provided: xa***' }),
    ).toEqual({ type: 'error', error: { type: 'api_error', message: 'Incorrect API key provided: xa***' } });
  });

  it('Mistral: a bare top-level message', () => {
    expect(toAnthropic({ message: 'Unauthorized', request_id: 'abc' })).toEqual({
      type: 'error',
      error: { type: 'api_error', message: 'Unauthorized' },
    });
  });

  it('Mistral: an error object with type', () => {
    expect(
      toAnthropic({ object: 'error', message: 'Invalid model', type: 'invalid_request_error', param: null, code: null }),
    ).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid model' } });
  });

  it('a structured detail is kept as JSON text', () => {
    const out = toAnthropic({ detail: [{ loc: ['body', 'model'], msg: 'field required' }] });
    expect(out.error.message).toContain('field required');
  });

  it('a numeric error code is kept as a string', () => {
    const ir = getAdapter('openai').parseResponse(JSON.stringify({ error: { message: 'bad', type: 'x', code: 400 } }));
    expect(ir).toEqual({ error: { type: 'x', message: 'bad', code: '400' } });
  });
});
