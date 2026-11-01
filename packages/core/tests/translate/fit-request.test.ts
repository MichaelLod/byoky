import { describe, it, expect } from 'vitest';
import { fitRequestToModel } from '../../src/translate/index.js';

/**
 * R4-01: OpenClaw (through @mariozechner/pi-ai) sends Claude requests whose
 * shape its users can't change. pi-ai 0.61.1 (OpenClaw 2026.3.x) and 0.73.0
 * (OpenClaw 2026.5.x) send thinking {type:'enabled', budget_tokens} to every
 * reasoning model whose id isn't Opus/Sonnet 4.6 (0.73: or Opus 4.7), and
 * 0.73 sends {type:'disabled'} with thinking off. Claude Opus 5.5 answers
 * both with a 400 (checked live 2026-11-01), so with OpenClaw's default
 * model every request failed. fitRequestToModel fits such a request to the
 * model it names and leaves a request that already fits byte for byte.
 */

const URL = 'https://api.anthropic.com/v1/messages';
const USER = [{ role: 'user', content: [{ type: 'text', text: 'Reply with a single word: ready' }] }];
const SYSTEM = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." }];

function fit(body: Record<string, unknown> | string, providerId = 'anthropic', url = URL): string {
  return fitRequestToModel({ providerId, url }, typeof body === 'string' ? body : JSON.stringify(body));
}

describe('fitRequestToModel — what OpenClaw sends', () => {
  it('turns pi-ai\'s thinking budget into adaptive thinking for Opus 5.5', () => {
    // pi-ai 0.73.0's body for claude-opus-5-5 with thinking on.
    const out = JSON.parse(fit({
      model: 'claude-opus-5-5', messages: USER, max_tokens: 2048, stream: true, system: SYSTEM,
      thinking: { type: 'enabled', budget_tokens: 1024, display: 'summarized' },
    }));
    expect(out).toEqual({
      model: 'claude-opus-5-5', messages: USER, max_tokens: 2048, stream: true, system: SYSTEM,
      thinking: { type: 'adaptive', display: 'summarized' },
    });
  });

  it('does the same for the other adaptive-only models', () => {
    for (const model of ['claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-4-7', 'claude-haiku-5-5']) {
      const out = JSON.parse(fit({ model, messages: USER, max_tokens: 2048, thinking: { type: 'enabled', budget_tokens: 1024 } }));
      expect(out.thinking, model).toEqual({ type: 'adaptive' });
    }
  });

  it('fits pi-ai 0.73\'s thinking off to the model', () => {
    const opus = JSON.parse(fit({ model: 'claude-opus-5-5', messages: USER, max_tokens: 2048, stream: true, thinking: { type: 'disabled' } }));
    expect(opus).toEqual({ model: 'claude-opus-5-5', messages: USER, max_tokens: 2048, stream: true });
    const sonnet = JSON.parse(fit({ model: 'claude-sonnet-5-5', messages: USER, max_tokens: 2048, thinking: { type: 'disabled' } }));
    expect(sonnet.thinking).toEqual({ type: 'between_tools' });
  });

  it('drops sampling and a forced tool choice the model rejects', () => {
    const tool = { name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: {} } };
    const out = JSON.parse(fit({
      model: 'claude-opus-5-5', messages: USER, max_tokens: 256, temperature: 0.7, tools: [tool], tool_choice: { type: 'any' },
    }));
    expect(out).not.toHaveProperty('temperature');
    expect(out.tool_choice).toEqual({ type: 'auto' });
    expect(out.system).toContain('You must call one of the provided tools');
  });
});

describe('fitRequestToModel — what it leaves alone, byte for byte', () => {
  it('a request that already fits its model', () => {
    const bodies = [
      // Claude Code on a current model.
      '{"model":"claude-opus-5-5","max_tokens":32000,"thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"messages":[],"stream":true}',
      // A thinking budget where one is taken.
      '{ "model": "claude-haiku-4-5-20251001", "max_tokens": 2048, "thinking": { "type": "enabled", "budget_tokens": 1024 }, "messages": [] }',
      '{"model":"claude-sonnet-4-6","max_tokens":64,"temperature":0.5,"messages":[]}',
      '{"model":"claude-opus-4-7","max_tokens":64,"thinking":{"type":"disabled"},"messages":[]}',
      '{"model":"claude-sonnet-5-5","max_tokens":64,"thinking":{"type":"between_tools"},"messages":[]}',
    ];
    for (const body of bodies) expect(fit(body)).toBe(body);
  });

  it('a model whose rules it would have to guess', () => {
    const body = '{"model":"claude-next","max_tokens":2048,"thinking":{"type":"enabled","budget_tokens":1024},"messages":[]}';
    expect(fit(body)).toBe(body);
    const noModel = '{"max_tokens":2048,"thinking":{"type":"enabled","budget_tokens":1024},"messages":[]}';
    expect(fit(noModel)).toBe(noModel);
  });

  it('other endpoints and other providers', () => {
    const body = '{"model":"claude-opus-5-5","thinking":{"type":"enabled","budget_tokens":1024},"messages":[]}';
    expect(fit(body, 'anthropic', 'https://api.anthropic.com/v1/messages/count_tokens')).toBe(body);
    const openai = '{"model":"gpt-5.5","max_tokens":64,"temperature":0.5,"messages":[]}';
    expect(fit(openai, 'openai', 'https://api.openai.com/v1/chat/completions')).toBe(openai);
    const gemini = '{"contents":[]}';
    expect(fit(gemini, 'gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')).toBe(gemini);
  });

  it('a body that is not a JSON object', () => {
    for (const body of ['', 'not json', '[1]', 'null']) expect(fit(body)).toBe(body);
  });
});
