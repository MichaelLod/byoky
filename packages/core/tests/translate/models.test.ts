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
} from '../../src/models.js';
import type { RequestLogEntry } from '../../src/types.js';

describe('MODELS', () => {
  it('contains the documented Anthropic frontier models', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('claude-opus-4-6');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });

  it('contains the documented OpenAI frontier models', () => {
    const ids = MODELS.map((m) => m.id);
    expect(ids).toContain('gpt-5.4');
    expect(ids).toContain('gpt-5.4-mini');
    expect(ids).toContain('gpt-5.4-nano');
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
  const nano = getModel('gpt-5.4-nano')!;

  it('returns empty when used capabilities are a subset of model capabilities', () => {
    const used: CapabilitySet = { tools: true, vision: false, structuredOutput: false, reasoning: false };
    expect(capabilityGaps(used, gpt54)).toEqual([]);
  });

  it('flags vision when used by app but unsupported by model', () => {
    const used: CapabilitySet = { tools: false, vision: true, structuredOutput: false, reasoning: false };
    // nano is text-only
    expect(capabilityGaps(used, nano)).toEqual(['vision']);
  });

  it('does not flag capabilities the app never used', () => {
    expect(capabilityGaps(EMPTY_CAPABILITY_SET, nano)).toEqual([]);
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
