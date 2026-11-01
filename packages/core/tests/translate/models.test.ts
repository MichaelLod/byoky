import { describe, it, expect } from 'vitest';
import {
  MODELS,
  DEFAULT_MODELS,
  getModel,
  modelsForProvider,
  modelsForFamily,
  capabilityGaps,
  detectAppCapabilities,
  capabilityLabel,
  EMPTY_CAPABILITY_SET,
  type CapabilitySet,
  type ModelEntry,
} from '../../src/models.js';
import type { RequestLogEntry } from '../../src/types.js';
import type { IRRequest } from '../../src/translate/ir.js';
import { anthropicAdapter } from '../../src/translate/adapters/anthropic.js';

describe('MODELS', () => {
  it('contains the documented Anthropic frontier models', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('claude-opus-5-5');
    expect(ids).toContain('claude-sonnet-5-5');
    expect(ids).toContain('claude-haiku-5-5');
    expect(ids).toContain('claude-fable-5-1');
    expect(ids).toContain('claude-opus-4-7');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });

  it('contains the Gemini model Google points new projects to', () => {
    expect(getModel('gemini-3.8-flash')?.family).toBe('gemini');
  });

  it('has no shut-down models', () => {
    // Requests to these fail at the provider (checked 2026-11-01).
    const shutDown = [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
      'claude-3-7-sonnet-20250219',
      'claude-3-5-haiku-20241022',
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite',
      'gemini-3.1-flash-lite-preview',
    ];
    const ids = MODELS.map((m) => m.id);
    for (const id of shutDown) expect(ids, id).not.toContain(id);
  });

  it('dates every deprecation and names its replacement', () => {
    const deprecated = MODELS.filter((m) => m.deprecated);
    expect(deprecated.map((m) => m.id)).toContain('gpt-5.4-nano');
    for (const m of deprecated) {
      expect(m.deprecated!.shutdown, m.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.deprecated!.replacement, m.id).not.toBe('');
    }
  });

  it('has GPT-6 Astra and Luna as OpenAI documents them', () => {
    // Model pages checked 2026-11-01: 1,050,000 context, 128K output, text and
    // image in; both answered a Chat Completions call (Luna with an image).
    for (const id of ['gpt-6-astra', 'gpt-6-luna']) {
      const m = getModel(id);
      expect(m, id).toMatchObject({ providerId: 'openai', family: 'openai', contextWindow: 1_050_000, maxOutput: 128_000 });
      expect(m?.capabilities, id).toMatchObject({ reasoning: true, vision: true, streaming: true, structuredOutput: true });
    }
    // Chat Completions takes Luna's tools with reasoning off; Astra's only
    // through the Responses API, which Byoky doesn't speak.
    expect(getModel('gpt-6-luna')?.capabilities.tools).toBe(true);
    expect(getModel('gpt-6-astra')?.capabilities).toMatchObject({ tools: false, toolChoice: false, parallelToolCalls: false });
    expect(capabilityGaps({ ...EMPTY_CAPABILITY_SET, tools: true }, getModel('gpt-6-astra')!)).toEqual(['tools']);
  });

  it('marks the Claude models that reject a forced tool choice', () => {
    expect(getModel('claude-opus-5-5')?.capabilities.toolChoice).toBe(false);
    expect(getModel('claude-sonnet-5-5')?.capabilities.toolChoice).toBe(false);
    expect(getModel('claude-fable-5-1')?.capabilities.toolChoice).toBe(false);
    expect(getModel('claude-haiku-5-5')?.capabilities.toolChoice).toBe(true);
  });

  it('agrees with the Anthropic serializer on forced tool choice', () => {
    const ir: IRRequest = {
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
      maxTokens: 100,
      tools: [{ name: 'f', parameters: { type: 'object', properties: {} } }],
      toolChoice: { type: 'tool', name: 'f' },
    };
    for (const m of modelsForFamily('anthropic')) {
      const out = JSON.parse(
        anthropicAdapter.serializeRequest(
          { srcFamily: 'openai', dstFamily: 'anthropic', srcModel: 'gpt-5.5', dstModel: m.id, isStreaming: false, requestId: 'r' },
          ir,
        ),
      ) as { tool_choice?: { type: string } };
      expect(out.tool_choice?.type === 'tool', m.id).toBe(m.capabilities.toolChoice);
    }
  });

  it('contains the documented OpenAI frontier models', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.4');
    expect(ids).toContain('gpt-5.4-mini');
    expect(ids).toContain('gpt-5.4-nano');
  });

  it('marks which models take images', () => {
    // gpt-5.4-nano takes images on Chat Completions (checked live 2026-11-01).
    expect(getModel('gpt-5.4-nano')?.capabilities.vision).toBe(true);
    expect(getModel('command-a-03-2025')?.capabilities.vision).toBe(false);
  });

  it('every entry has a non-zero context window and max output', () => {
    for (const m of MODELS) {
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxOutput).toBeGreaterThan(0);
    }
  });

  it('every entry declares its family', () => {
    const valid = new Set(['anthropic', 'openai', 'gemini', 'cohere']);
    for (const m of MODELS) {
      expect(valid.has(m.family)).toBe(true);
    }
  });
});

describe('DEFAULT_MODELS', () => {
  it('never names a deprecated model', () => {
    for (const id of Object.values(DEFAULT_MODELS)) expect(getModel(id)?.deprecated, id).toBeUndefined();
  });

  it('points at registered models for each family', () => {
    expect(getModel(DEFAULT_MODELS.anthropic)).toBeDefined();
    expect(getModel(DEFAULT_MODELS.openai)).toBeDefined();
    expect(getModel(DEFAULT_MODELS.gemini)).toBeDefined();
    expect(getModel(DEFAULT_MODELS.cohere)).toBeDefined();
  });

  it('default per family belongs to that family', () => {
    expect(getModel(DEFAULT_MODELS.anthropic)?.family).toBe('anthropic');
    expect(getModel(DEFAULT_MODELS.openai)?.family).toBe('openai');
    expect(getModel(DEFAULT_MODELS.gemini)?.family).toBe('gemini');
    expect(getModel(DEFAULT_MODELS.cohere)?.family).toBe('cohere');
  });
});

describe('getModel', () => {
  it('returns the entry for a known id', () => {
    const m = getModel('claude-sonnet-4-6');
    expect(m).toBeDefined();
    expect(m?.providerId).toBe('anthropic');
  });

  it('returns undefined for unknown ids', () => {
    expect(getModel('claude-galaxy-9000')).toBeUndefined();
  });
});

describe('modelsForProvider', () => {
  it('returns only entries for the given provider', () => {
    const list = modelsForProvider('anthropic');
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) expect(m.providerId).toBe('anthropic');
  });

  it('returns empty for providers with no registered models', () => {
    expect(modelsForProvider('groq')).toEqual([]);
  });
});

describe('modelsForFamily', () => {
  it('groups by family across providers', () => {
    const total =
      modelsForFamily('anthropic').length +
      modelsForFamily('openai').length +
      modelsForFamily('gemini').length +
      modelsForFamily('cohere').length;
    expect(total).toBe(MODELS.length);
  });
});

describe('capabilityGaps', () => {
  const gpt54 = getModel('gpt-5.4')!;
  // A text-only model of the same family, so only vision differs.
  const textOnly: ModelEntry = { ...gpt54, id: 'text-only-model', capabilities: { ...gpt54.capabilities, vision: false } };

  it('returns empty when used capabilities are a subset of model capabilities', () => {
    const used: CapabilitySet = { tools: true, vision: false, structuredOutput: false, reasoning: false };
    expect(capabilityGaps(used, gpt54)).toEqual([]);
  });

  it('flags vision when used by app but unsupported by model', () => {
    const used: CapabilitySet = { tools: false, vision: true, structuredOutput: false, reasoning: false };
    expect(capabilityGaps(used, textOnly)).toEqual(['vision']);
    expect(capabilityGaps(used, getModel('command-a-03-2025')!)).toEqual(['vision']);
  });

  it('does not flag capabilities the app never used', () => {
    expect(capabilityGaps(EMPTY_CAPABILITY_SET, textOnly)).toEqual([]);
  });
});

describe('detectAppCapabilities', () => {
  function entry(used?: CapabilitySet): RequestLogEntry {
    return {
      id: 'x',
      sessionId: 's',
      appOrigin: 'http://example',
      providerId: 'anthropic',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      status: 200,
      timestamp: 0,
      ...(used ? { usedCapabilities: used } : {}),
    };
  }

  it('returns all-false for an empty list', () => {
    expect(detectAppCapabilities([])).toEqual(EMPTY_CAPABILITY_SET);
  });

  it('OR-merges capabilities across entries', () => {
    const merged = detectAppCapabilities([
      entry({ tools: true, vision: false, structuredOutput: false, reasoning: false }),
      entry({ tools: false, vision: true, structuredOutput: false, reasoning: false }),
      entry({ tools: false, vision: false, structuredOutput: false, reasoning: true }),
    ]);
    expect(merged).toEqual({ tools: true, vision: true, structuredOutput: false, reasoning: true });
  });

  it('ignores entries without usedCapabilities', () => {
    expect(detectAppCapabilities([entry(), entry()])).toEqual(EMPTY_CAPABILITY_SET);
  });
});

describe('capabilityLabel', () => {
  it('returns a human label for each key', () => {
    expect(capabilityLabel('tools')).toMatch(/tool/i);
    expect(capabilityLabel('vision')).toMatch(/image/i);
    expect(capabilityLabel('structuredOutput')).toMatch(/structured/i);
    expect(capabilityLabel('reasoning')).toMatch(/reasoning/i);
  });
});
