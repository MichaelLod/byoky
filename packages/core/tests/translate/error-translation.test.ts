import { describe, it, expect } from 'vitest';
import { translateErrorResponse, createStreamTranslator, getAdapter, isIRError } from '../../src/translate/index.js';
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

/**
 * R4-04: a translated error kept the upstream's own type, so a Gemini 429
 * reached an Anthropic app as error.type RESOURCE_EXHAUSTED instead of
 * rate_limit_error. The type is now the app's dialect's, read from the HTTP
 * status first (the status itself is kept by the caller).
 */
describe('translateErrorResponse — the app dialect\'s error types', () => {
  /** A 429 in each destination dialect. */
  const RATE_LIMITED: Record<ModelFamily, string> = {
    anthropic: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }),
    openai: JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_error', code: 'slow_down' } }),
    gemini: JSON.stringify({ error: { code: 429, message: 'slow down', status: 'RESOURCE_EXHAUSTED' } }),
    cohere: JSON.stringify({ id: 'x', message: 'slow down' }),
  };

  /** What each app dialect reads for a 429. */
  function expectRateLimit(src: ModelFamily, out: string, dst: ModelFamily) {
    const body = JSON.parse(out);
    switch (src) {
      case 'anthropic':
        expect(body).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
        break;
      case 'openai':
        // An OpenAI code is a name; Gemini's numeric status isn't one.
        expect(body).toEqual({ error: { message: 'slow down', type: 'rate_limit_error', code: null } });
        break;
      case 'gemini':
        expect(body).toEqual({ error: { code: 429, message: 'slow down', status: 'RESOURCE_EXHAUSTED' } });
        break;
      case 'cohere':
        expect(body, dst).toEqual({ message: 'slow down' });
        break;
    }
  }

  for (const src of FAMILIES) {
    for (const dst of FAMILIES) {
      if (src === dst) continue;
      it(`${dst} 429 → ${src} app`, () => {
        expectRateLimit(src, translateErrorResponse(ctx(src, dst), RATE_LIMITED[dst], 429)!, dst);
      });
    }
  }

  it('reads Gemini\'s status from its body when the caller passes none', () => {
    const out = JSON.parse(translateErrorResponse(ctx('anthropic', 'gemini'), RATE_LIMITED.gemini)!);
    expect(out.error.type).toBe('rate_limit_error');
  });

  it('goes by the HTTP status before the upstream\'s type', () => {
    // OpenAI answers a bad key with a 401 of type invalid_request_error (live).
    const badKey = ERROR_BODIES.openai;
    expect(JSON.parse(translateErrorResponse(ctx('anthropic', 'openai'), badKey, 401)!).error.type).toBe('authentication_error');
    expect(JSON.parse(translateErrorResponse(ctx('gemini', 'openai'), badKey, 401)!).error).toEqual({
      code: 401, message: 'Incorrect API key provided', status: 'UNAUTHENTICATED',
    });
    // Without the status, the type stands for one.
    expect(JSON.parse(translateErrorResponse(ctx('anthropic', 'openai'), badKey)!).error.type).toBe('invalid_request_error');
    // OpenAI repeats the status in the body.
    const withStatus = JSON.stringify({ error: { message: 'm', type: 'invalid_request_error', code: 'invalid_api_key' }, status: 401 });
    expect(JSON.parse(translateErrorResponse(ctx('anthropic', 'openai'), withStatus)!).error.type).toBe('authentication_error');
  });

  it('maps each documented status for an Anthropic app', () => {
    const cases: Array<[number, string]> = [
      [400, 'invalid_request_error'], [401, 'authentication_error'], [402, 'billing_error'], [403, 'permission_error'],
      [404, 'not_found_error'], [409, 'conflict_error'], [413, 'request_too_large'], [422, 'invalid_request_error'],
      [429, 'rate_limit_error'], [500, 'api_error'], [502, 'api_error'], [503, 'overloaded_error'],
      [504, 'timeout_error'], [529, 'overloaded_error'],
    ];
    for (const [status, type] of cases) {
      const out = JSON.parse(translateErrorResponse(ctx('anthropic', 'cohere'), ERROR_BODIES.cohere, status)!);
      expect(out.error.type, String(status)).toBe(type);
    }
  });

  it('maps each status for an OpenAI app', () => {
    const cases: Array<[number, string]> = [
      [400, 'invalid_request_error'], [401, 'invalid_request_error'], [404, 'invalid_request_error'],
      [429, 'rate_limit_error'], [500, 'server_error'], [503, 'service_unavailable_error'], [529, 'service_unavailable_error'],
    ];
    for (const [status, type] of cases) {
      const out = JSON.parse(translateErrorResponse(ctx('openai', 'anthropic'), ERROR_BODIES.anthropic, status)!);
      expect(out.error.type, String(status)).toBe(type);
    }
  });

  it('maps each status for a Gemini app', () => {
    const cases: Array<[number, string]> = [
      [400, 'INVALID_ARGUMENT'], [401, 'UNAUTHENTICATED'], [403, 'PERMISSION_DENIED'], [404, 'NOT_FOUND'],
      [429, 'RESOURCE_EXHAUSTED'], [500, 'INTERNAL'], [503, 'UNAVAILABLE'], [504, 'DEADLINE_EXCEEDED'], [529, 'UNAVAILABLE'],
    ];
    for (const [status, name] of cases) {
      const out = JSON.parse(translateErrorResponse(ctx('gemini', 'anthropic'), ERROR_BODIES.anthropic, status)!);
      expect(out.error, String(status)).toEqual({ code: status, message: 'invalid x-api-key', status: name });
    }
  });

  it('reads the type of an error with no status from the upstream\'s own type', () => {
    // Anthropic's authentication_error stands for a 401.
    expect(JSON.parse(translateErrorResponse(ctx('gemini', 'anthropic'), ERROR_BODIES.anthropic)!).error)
      .toEqual({ code: 401, message: 'invalid x-api-key', status: 'UNAUTHENTICATED' });
    expect(JSON.parse(translateErrorResponse(ctx('openai', 'anthropic'), ERROR_BODIES.anthropic)!).error.type)
      .toBe('invalid_request_error');
  });

  it('puts a mid-stream error in the app\'s types too', () => {
    const toAnthropic = createStreamTranslator({ ...ctx('anthropic', 'gemini'), isStreaming: true });
    const out = toAnthropic.process('data: {"error":{"code":429,"message":"slow down","status":"RESOURCE_EXHAUSTED"}}\n\n') + toAnthropic.flush();
    expect(out).toContain('"type":"rate_limit_error"');
    expect(out).not.toContain('RESOURCE_EXHAUSTED');

    const toGemini = createStreamTranslator({ ...ctx('gemini', 'anthropic'), isStreaming: true });
    const gemini = toGemini.process('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n') + toGemini.flush();
    expect(gemini).toContain('"code":529');
    expect(gemini).toContain('"status":"UNAVAILABLE"');

    const toOpenAI = createStreamTranslator({ ...ctx('openai', 'anthropic'), isStreaming: true });
    const openai = toOpenAI.process('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n') + toOpenAI.flush();
    expect(openai).toContain('"type":"service_unavailable_error"');
  });
});
