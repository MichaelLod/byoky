import { describe, it, expect } from 'vitest';
import { rewriteRequestModel, rewriteRequestUrl } from '../../src/translate/index.js';

/**
 * R3-05: a group that pins another model of the app's own family used to
 * change only `model`, so the destination model's request rules (applied
 * on cross-family translation) were skipped and the request got a 400
 * (temperature or a forced tool choice to Claude Sonnet 5.5, max_tokens or
 * temperature to an OpenAI reasoning model). The expected 400s were checked
 * live on 2026-11-01.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Weather for a city',
  input_schema: { type: 'object', properties: { city: { type: 'string' } } },
};
const OPENAI_TOOL = {
  type: 'function',
  function: { name: 'get_weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
};
const USER = [{ role: 'user', content: 'Weather in Vienna?' }];

function rewrite(dstProviderId: string, dstModel: string, body: Record<string, unknown>, url?: string) {
  const out = rewriteRequestModel(
    { dstProviderId, dstModel, url: url ?? (dstProviderId === 'anthropic' ? ANTHROPIC_URL : OPENAI_URL) },
    JSON.stringify(body),
  );
  return JSON.parse(out) as Record<string, unknown>;
}

describe('rewriteRequestModel — what it leaves alone', () => {
  it('returns a request that already names the model byte for byte, rules and all', () => {
    const body = '{ "model": "claude-sonnet-5-5", "max_tokens": 8, "temperature": 0.5, "messages": [] }';
    expect(rewriteRequestModel({ dstProviderId: 'anthropic', dstModel: 'claude-sonnet-5-5', url: ANTHROPIC_URL }, body)).toBe(body);
  });

  it('returns a body that is not a JSON object as it was', () => {
    for (const body of ['not json', '[1,2]', '"text"', 'null']) {
      expect(rewriteRequestModel({ dstProviderId: 'openai', dstModel: 'gpt-5.5', url: OPENAI_URL }, body)).toBe(body);
    }
  });

  it('only sets the model of a request to another endpoint', () => {
    const responses = rewrite('openai', 'gpt-5.5', { model: 'gpt-4.1', max_output_tokens: 64, temperature: 0.5, input: 'hi' },
      'https://api.openai.com/v1/responses');
    expect(responses).toEqual({ model: 'gpt-5.5', max_output_tokens: 64, temperature: 0.5, input: 'hi' });
    const count = rewrite('anthropic', 'claude-sonnet-5-5', { model: 'claude-sonnet-4-6', temperature: 0.5, messages: USER },
      'https://api.anthropic.com/v1/messages/count_tokens');
    expect(count.temperature).toBe(0.5);
  });

  it('leaves a Gemini body as it is: the model is in the URL (rewriteRequestUrl)', () => {
    // R4-03: Gemini ignores a body `model` (live 2026-11-01: models/gemini-2.5-flash
    // with body model gemini-3.5-flash-lite answered as gemini-2.5-flash).
    const body = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { temperature: 0.5 } });
    expect(rewriteRequestModel({
      dstProviderId: 'gemini', dstModel: 'gemini-3.8-flash',
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    }, body)).toBe(body);
  });

  it('only sets the model for families without per-model rules', () => {
    expect(rewrite('cohere', 'command-a-03-2025', { model: 'command-r', temperature: 0.5, messages: USER }, 'https://api.cohere.com/v2/chat'))
      .toEqual({ model: 'command-a-03-2025', temperature: 0.5, messages: USER });
  });

  it('keeps every field the rules do not cover', () => {
    const body = {
      model: 'claude-sonnet-4-6',
      max_tokens: 64,
      stream: true,
      metadata: { user_id: 'u1' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: 'Be terse.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }],
      something_new: { kept: true },
    };
    expect(rewrite('anthropic', 'claude-sonnet-5-5', body)).toEqual({ ...body, model: 'claude-sonnet-5-5' });
  });
});

describe('rewriteRequestUrl — Gemini names the model in the URL', () => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
  const pin = (url: string, dstModel = 'gemini-3.8-flash', dstProviderId = 'gemini') => rewriteRequestUrl({ dstProviderId, dstModel, url });

  it('names the pinned model in a generateContent, streaming or countTokens URL', () => {
    expect(pin(`${GEMINI}/gemini-2.5-flash:generateContent`)).toBe(`${GEMINI}/gemini-3.8-flash:generateContent`);
    expect(pin(`${GEMINI}/gemini-2.5-flash:streamGenerateContent?alt=sse`)).toBe(`${GEMINI}/gemini-3.8-flash:streamGenerateContent?alt=sse`);
    expect(pin(`${GEMINI}/gemini-2.5-pro:countTokens`)).toBe(`${GEMINI}/gemini-3.8-flash:countTokens`);
    expect(pin('https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent'))
      .toBe('https://generativelanguage.googleapis.com/v1/models/gemini-3.8-flash:generateContent');
  });

  it('keeps the query as it was and encodes the model like the URL builder', () => {
    expect(pin(`${GEMINI}/gemini-2.5-flash:streamGenerateContent?alt=sse&x=a%20b`, 'tuned model'))
      .toBe(`${GEMINI}/tuned%20model:streamGenerateContent?alt=sse&x=a%20b`);
  });

  it('leaves other Gemini endpoints and other families alone', () => {
    for (const url of [`${GEMINI}/text-embedding-004:embedContent`, `${GEMINI}`, `${GEMINI}/gemini-2.5-flash`, 'not a url']) {
      expect(pin(url), url).toBe(url);
    }
    expect(pin('https://api.openai.com/v1/chat/completions', 'gpt-5.5', 'openai')).toBe('https://api.openai.com/v1/chat/completions');
    expect(pin('https://api.anthropic.com/v1/messages', 'claude-opus-5-5', 'anthropic')).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('rewriteRequestModel — Claude', () => {
  it('drops sampling parameters for a model that rejects them', () => {
    // Live: claude-sonnet-5-5 answers 400 "`temperature` is deprecated for this model."
    const out = rewrite('anthropic', 'claude-sonnet-5-5', { model: 'claude-sonnet-4-6', max_tokens: 64, temperature: 0.5, top_p: 0.9, top_k: 5, messages: USER });
    expect(out).toEqual({ model: 'claude-sonnet-5-5', max_tokens: 64, messages: USER });
  });

  it('turns a forced tool choice into auto plus an instruction on a model that rejects one', () => {
    // Live: 400 "tool_choice: type "tool" and "any" are not supported for this model."
    const out = rewrite('anthropic', 'claude-sonnet-5-5', {
      model: 'claude-sonnet-4-6', max_tokens: 64, system: 'Be terse.', messages: USER,
      tools: [WEATHER_TOOL], tool_choice: { type: 'tool', name: 'get_weather', disable_parallel_tool_use: true },
    });
    expect(out.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
    expect(out.system).toBe('Be terse.\n\nYou must call the get_weather tool in this response. Start your response with that tool call.');
    expect(out.tools).toEqual([WEATHER_TOOL]);
  });

  it('adds the instruction to a system prompt in blocks, or as the system prompt', () => {
    const cached = { type: 'text', text: 'Be terse.', cache_control: { type: 'ephemeral' } };
    const blocks = rewrite('anthropic', 'claude-opus-5-5', {
      model: 'claude-opus-4-7', max_tokens: 64, system: [cached], messages: USER, tools: [WEATHER_TOOL], tool_choice: { type: 'any' },
    });
    expect(blocks.system).toEqual([cached, { type: 'text', text: 'You must call one of the provided tools in this response. Start your response with a tool call.' }]);
    expect(blocks.tool_choice).toEqual({ type: 'auto' });
    const none = rewrite('anthropic', 'claude-fable-5-1', {
      model: 'claude-opus-4-7', max_tokens: 64, messages: USER, tools: [WEATHER_TOOL], tool_choice: { type: 'tool', name: 'get_weather' },
    });
    expect(none.system).toBe('You must call the get_weather tool in this response. Start your response with that tool call.');
  });

  it('adds no instruction for a forced choice without tools', () => {
    const out = rewrite('anthropic', 'claude-sonnet-5-5', { model: 'claude-sonnet-4-6', max_tokens: 64, messages: USER, tool_choice: { type: 'any' } });
    expect(out.tool_choice).toEqual({ type: 'auto' });
    expect(out).not.toHaveProperty('system');
  });

  it('keeps a forced tool choice for a model that takes one, and drops thinking for it', () => {
    const out = rewrite('anthropic', 'claude-haiku-5-5', {
      model: 'claude-sonnet-4-6', max_tokens: 4096, messages: USER, tools: [WEATHER_TOOL],
      tool_choice: { type: 'tool', name: 'get_weather' }, thinking: { type: 'enabled', budget_tokens: 2048 },
    });
    expect(out.tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
    expect(out).not.toHaveProperty('thinking');
    expect(out).not.toHaveProperty('system');
  });

  it('turns a thinking budget into adaptive thinking for a model that only thinks adaptively', () => {
    // Live: 400 ""thinking.type.enabled" is not supported for this model."
    const out = rewrite('anthropic', 'claude-sonnet-5-5', {
      model: 'claude-sonnet-4-6', max_tokens: 4096, messages: USER, thinking: { type: 'enabled', budget_tokens: 2048, display: 'summarized' },
    });
    expect(out.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('keeps a thinking budget, and holds sampling to thinking\'s limits, on Claude 4.6', () => {
    const out = rewrite('anthropic', 'claude-sonnet-4-6', {
      model: 'claude-haiku-4-5', max_tokens: 4096, messages: USER, thinking: { type: 'enabled', budget_tokens: 2048 },
      temperature: 0.5, top_k: 5, top_p: 0.97,
    });
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(out).not.toHaveProperty('temperature');
    expect(out).not.toHaveProperty('top_k');
    expect(out.top_p).toBe(0.97);
    const low = rewrite('anthropic', 'claude-sonnet-4-6', {
      model: 'claude-haiku-4-5', max_tokens: 4096, messages: USER, thinking: { type: 'adaptive' }, top_p: 0.5,
    });
    expect(low.thinking).toEqual({ type: 'adaptive' });
    expect(low).not.toHaveProperty('top_p');
  });

  it('keeps temperature or top_p, not both, on a model that takes sampling', () => {
    const out = rewrite('anthropic', 'claude-sonnet-4-6', { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, temperature: 0.5, top_p: 0.9 });
    expect(out.temperature).toBe(0.5);
    expect(out).not.toHaveProperty('top_p');
  });

  it('drops adaptive thinking for a model that only takes a budget', () => {
    const out = rewrite('anthropic', 'claude-haiku-4-5-20251001', {
      model: 'claude-sonnet-4-6', max_tokens: 64, messages: USER, thinking: { type: 'adaptive' }, temperature: 0.5,
    });
    expect(out).not.toHaveProperty('thinking');
    // No thinking left, so the temperature stays.
    expect(out.temperature).toBe(0.5);
  });
});

/**
 * R4-02: thinking turned off and the effort level have per-model rules too
 * (each 400 checked live on 2026-11-01 with the message quoted).
 */
describe('rewriteRequestModel — Claude thinking off and effort', () => {
  it('leaves thinking out for a model that always thinks', () => {
    // Opus 5.5 and Fable 5.1: 400 ""thinking.type.disabled" is not supported for this model."
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-mythos-5-1']) {
      const out = rewrite('anthropic', model, { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, thinking: { type: 'disabled' } });
      expect(out, model).toEqual({ model, max_tokens: 64, messages: USER });
    }
  });

  it('turns thinking off with between_tools on Sonnet 5.5', () => {
    // 400 "To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}."
    const out = rewrite('anthropic', 'claude-sonnet-5-5', { model: 'claude-sonnet-4-6', max_tokens: 64, messages: USER, thinking: { type: 'disabled' } });
    expect(out.thinking).toEqual({ type: 'between_tools' });
  });

  it('turns between_tools back into disabled on a model that takes that', () => {
    for (const model of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-5', 'claude-haiku-5-5']) {
      const out = rewrite('anthropic', model, { model: 'claude-sonnet-5-5', max_tokens: 64, messages: USER, thinking: { type: 'between_tools' } });
      expect(out.thinking, model).toEqual({ type: 'disabled' });
    }
    const always = rewrite('anthropic', 'claude-opus-5-5', { model: 'claude-sonnet-5-5', max_tokens: 64, messages: USER, thinking: { type: 'between_tools' } });
    expect(always).not.toHaveProperty('thinking');
  });

  it('keeps thinking off as it is where the model takes it', () => {
    for (const model of ['claude-opus-4-7', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5-5']) {
      const out = rewrite('anthropic', model, { model: 'claude-opus-5-5', max_tokens: 64, messages: USER, thinking: { type: 'disabled' } });
      expect(out.thinking, model).toEqual({ type: 'disabled' });
    }
  });

  it('holds effort to high while thinking is off on models that turn it off only that far', () => {
    // Opus 5: 400 "output_config.effort 'xhigh' is not supported when thinking is disabled on this model."
    const opus5 = rewrite('anthropic', 'claude-opus-5', {
      model: 'claude-opus-4-8', max_tokens: 64, messages: USER, thinking: { type: 'disabled' }, output_config: { effort: 'xhigh' },
    });
    expect(opus5.thinking).toEqual({ type: 'disabled' });
    expect(opus5.output_config).toEqual({ effort: 'high' });
    const sonnet = rewrite('anthropic', 'claude-sonnet-5-5', {
      model: 'claude-opus-4-8', max_tokens: 64, messages: USER, thinking: { type: 'disabled' }, output_config: { effort: 'max', format: { type: 'json_schema' } },
    });
    expect(sonnet.thinking).toEqual({ type: 'between_tools' });
    expect(sonnet.output_config).toEqual({ effort: 'high', format: { type: 'json_schema' } });
    // With thinking on, every level is taken.
    const on = rewrite('anthropic', 'claude-opus-5', { model: 'claude-opus-4-8', max_tokens: 64, messages: USER, output_config: { effort: 'max' } });
    expect(on.output_config).toEqual({ effort: 'max' });
  });

  it('drops effort for a model that takes none, keeping the rest of output_config', () => {
    // Haiku 4.5, Sonnet 4.5: 400 "This model does not support the effort parameter."
    for (const model of ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5']) {
      const out = rewrite('anthropic', model, { model: 'claude-sonnet-4-6', max_tokens: 64, messages: USER, output_config: { effort: 'low' } });
      expect(out, model).not.toHaveProperty('output_config');
      const format = { type: 'json_schema', schema: { type: 'object' } };
      const withFormat = rewrite('anthropic', model, { model: 'claude-sonnet-4-6', max_tokens: 64, messages: USER, output_config: { effort: 'low', format } });
      expect(withFormat.output_config, model).toEqual({ format });
    }
  });

  it('lowers an effort level the model lacks to the nearest one it has', () => {
    // Opus 4.6: 400 "This model does not support effort level 'xhigh'. Supported levels: high, low, max, medium."
    const fourSix = rewrite('anthropic', 'claude-opus-4-6', { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, output_config: { effort: 'xhigh' } });
    expect(fourSix.output_config).toEqual({ effort: 'high' });
    expect(rewrite('anthropic', 'claude-sonnet-4-6', { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, output_config: { effort: 'max' } }).output_config)
      .toEqual({ effort: 'max' });
    // Opus 4.5: 400 "This model does not support effort level 'max'. Supported levels: high, low, medium."
    const fourFive = rewrite('anthropic', 'claude-opus-4-5', { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, output_config: { effort: 'max' } });
    expect(fourFive.output_config).toEqual({ effort: 'high' });
    expect(rewrite('anthropic', 'claude-opus-4-5', { model: 'claude-opus-4-7', max_tokens: 64, messages: USER, output_config: { effort: 'medium' } }).output_config)
      .toEqual({ effort: 'medium' });
  });

  it('leaves effort and thinking off alone for an id it can\'t read', () => {
    const out = rewrite('anthropic', 'claude-next', {
      model: 'claude-opus-4-7', max_tokens: 64, messages: USER, thinking: { type: 'between_tools' }, output_config: { effort: 'turbo' },
    });
    expect(out.thinking).toEqual({ type: 'between_tools' });
    expect(out.output_config).toEqual({ effort: 'turbo' });
  });
});

describe('rewriteRequestModel — OpenAI reasoning models', () => {
  it('moves max_tokens to max_completion_tokens and drops sampling for gpt-5.5', () => {
    // Live: 400 "Unsupported parameter: 'max_tokens' ..." and "'temperature' does not support 0.5 with this model".
    const out = rewrite('openai', 'gpt-5.5', {
      model: 'gpt-4.1', max_tokens: 64, temperature: 0.5, top_p: 0.9, logprobs: true, top_logprobs: 2, stream: true, messages: USER,
    });
    expect(out).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, stream: true, messages: USER });
  });

  it('keeps an explicit max_completion_tokens', () => {
    const out = rewrite('openai', 'gpt-5.5', { model: 'gpt-4.1', max_tokens: 64, max_completion_tokens: 128, messages: USER });
    expect(out.max_completion_tokens).toBe(128);
    expect(out).not.toHaveProperty('max_tokens');
  });

  it('keeps sampling when the request turns reasoning off', () => {
    const out = rewrite('openai', 'gpt-5.5', { model: 'gpt-4.1', reasoning_effort: 'none', temperature: 0.5, messages: USER });
    expect(out.temperature).toBe(0.5);
  });

  it('leaves tools and reasoning alone on gpt-5.5', () => {
    const out = rewrite('openai', 'gpt-5.5', { model: 'gpt-4.1', max_completion_tokens: 64, tools: [OPENAI_TOOL], tool_choice: 'required', messages: USER });
    expect(out).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, tools: [OPENAI_TOOL], tool_choice: 'required', messages: USER });
  });

  it('turns reasoning off for tools on a GPT-6 model that calls them only that way', () => {
    const out = rewrite('openai', 'gpt-6-luna', {
      model: 'gpt-5.5', max_tokens: 64, temperature: 0.5, reasoning_effort: 'high', tools: [OPENAI_TOOL], messages: USER,
    });
    expect(out).toEqual({
      model: 'gpt-6-luna', max_completion_tokens: 64, temperature: 0.5, reasoning_effort: 'none', tools: [OPENAI_TOOL], messages: USER,
    });
  });

  it('refuses tools for a GPT-6 model that can\'t turn reasoning off', () => {
    expect(() => rewrite('openai', 'gpt-6-astra', { model: 'gpt-5.5', tools: [OPENAI_TOOL], messages: USER }))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FEATURE', message: expect.stringContaining('gpt-6-astra') }));
    // Without tools it is served.
    expect(rewrite('openai', 'gpt-6-astra', { model: 'gpt-5.5', max_tokens: 64, messages: USER }))
      .toEqual({ model: 'gpt-6-astra', max_completion_tokens: 64, messages: USER });
  });

  it('leaves a non-reasoning model\'s request as the app wrote it', () => {
    const out = rewrite('openai', 'gpt-4.1', { model: 'gpt-5.5', max_tokens: 64, temperature: 0.5, messages: USER });
    expect(out).toEqual({ model: 'gpt-4.1', max_tokens: 64, temperature: 0.5, messages: USER });
  });

  it('keeps max_tokens on hosts that document it, still dropping sampling', () => {
    const out = rewrite('openrouter', 'openai/gpt-5.5', { model: 'anthropic/claude-sonnet-4.6', max_tokens: 64, temperature: 0.5, messages: USER },
      'https://openrouter.ai/api/v1/chat/completions');
    expect(out).toEqual({ model: 'openai/gpt-5.5', max_tokens: 64, messages: USER });
  });

  it('applies to a same-family swap onto Azure OpenAI', () => {
    const out = rewrite('azure_openai', 'gpt-5.5', { model: 'llama-3.3-70b-versatile', max_tokens: 64, temperature: 0.5, messages: USER },
      'https://api.groq.com/openai/v1/chat/completions');
    expect(out).toEqual({ model: 'gpt-5.5', max_completion_tokens: 64, messages: USER });
  });
});
