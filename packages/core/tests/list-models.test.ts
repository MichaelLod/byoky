import { describe, it, expect } from 'vitest';
import {
  getListModelsEndpoint,
  getStaticModelsList,
  parseModelsList,
} from '../src/list-models.js';

describe('getListModelsEndpoint', () => {
  it('maps each non-perplexity provider to a path', () => {
    const expected: Array<[string, string]> = [
      ['openai', '/v1/models'],
      ['anthropic', '/v1/models'],
      ['gemini', '/v1beta/models'],
      ['mistral', '/v1/models'],
      ['cohere', '/v1/models'],
      ['xai', '/v1/models'],
      ['deepseek', '/models'],
      ['groq', '/openai/v1/models'],
      ['together', '/v1/models'],
      ['fireworks', '/inference/v1/models'],
      ['openrouter', '/v1/models'],
      ['azure_openai', '/openai/models?api-version=2024-10-21'],
      ['ollama', '/api/tags'],
      ['lm_studio', '/v1/models'],
    ];
    for (const [providerId, path] of expected) {
      const ep = getListModelsEndpoint(providerId);
      expect(ep, providerId).not.toBeNull();
      expect(ep!.method).toBe('GET');
      expect(ep!.path).toBe(path);
    }
  });

  it('attaches anthropic-version header for anthropic', () => {
    const ep = getListModelsEndpoint('anthropic');
    expect(ep?.headers?.['anthropic-version']).toBe('2023-06-01');
  });

  it('returns null for perplexity (no endpoint)', () => {
    expect(getListModelsEndpoint('perplexity')).toBeNull();
  });

  it('returns null for unknown providers', () => {
    expect(getListModelsEndpoint('does-not-exist')).toBeNull();
  });
});

describe('getStaticModelsList — perplexity fallback', () => {
  it('returns the Sonar family with reasoning flags', () => {
    const list = getStaticModelsList('perplexity');
    expect(list.length).toBeGreaterThanOrEqual(5);
    const ids = list.map((m) => m.id);
    expect(ids).toContain('sonar');
    expect(ids).toContain('sonar-pro');
    expect(ids).toContain('sonar-reasoning');
    expect(ids).toContain('sonar-reasoning-pro');
    expect(ids).toContain('sonar-deep-research');
    for (const m of list) expect(m.providerId).toBe('perplexity');
    const reasoning = list.find((m) => m.id === 'sonar-reasoning');
    expect(reasoning?.capabilities?.reasoning).toBe(true);
  });

  it('returns an empty array for providers that have a real endpoint', () => {
    expect(getStaticModelsList('openai')).toEqual([]);
    expect(getStaticModelsList('anthropic')).toEqual([]);
  });
});

describe('parseModelsList — OpenAI-compatible {data:[...]}', () => {
  // Real-shape fixture matching api.openai.com/v1/models responses.
  const fixture = {
    object: 'list',
    data: [
      { id: 'gpt-5.4', object: 'model', created: 1_715_367_049, owned_by: 'system' },
      { id: 'gpt-5.4-mini', object: 'model', created: 1_721_172_741, owned_by: 'system' },
    ],
  };

  it('extracts ids from openai response', () => {
    const out = parseModelsList('openai', fixture);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id)).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
    expect(out[0].providerId).toBe('openai');
    expect(out[0].raw).toEqual(fixture.data[0]);
  });

  it('works the same for groq, deepseek, mistral, xai, fireworks, openrouter, lm_studio', () => {
    for (const pid of ['groq', 'deepseek', 'mistral', 'xai', 'fireworks', 'openrouter', 'lm_studio']) {
      const out = parseModelsList(pid, fixture);
      expect(out, pid).toHaveLength(2);
      expect(out[0].providerId, pid).toBe(pid);
    }
  });

  it('reads context_length / context_window / max_context_length when present', () => {
    const withCtx = {
      data: [
        { id: 'a', context_length: 32_000 },
        { id: 'b', context_window: 64_000 },
        { id: 'c', max_context_length: 128_000 },
      ],
    };
    const out = parseModelsList('openai', withCtx);
    expect(out.map((m) => m.contextWindow)).toEqual([32_000, 64_000, 128_000]);
  });

  it('reads display_name when present (mistral/together provide one)', () => {
    const out = parseModelsList('mistral', {
      data: [{ id: 'mistral-large', display_name: 'Mistral Large' }],
    });
    expect(out[0].displayName).toBe('Mistral Large');
  });

  it('skips entries with no id', () => {
    const out = parseModelsList('openai', {
      data: [{ id: 'real' }, { object: 'model' }, null, 42, { id: '' }],
    });
    expect(out.map((m) => m.id)).toEqual(['real']);
  });

  it('falls back to a plain array body (Together AI)', () => {
    const togetherFixture = [
      {
        id: 'meta-llama/Llama-3-70b-chat-hf',
        object: 'model',
        type: 'chat',
        display_name: 'Llama 3 70B Chat',
        context_length: 8192,
      },
    ];
    const out = parseModelsList('together', togetherFixture);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('meta-llama/Llama-3-70b-chat-hf');
    expect(out[0].displayName).toBe('Llama 3 70B Chat');
    expect(out[0].contextWindow).toBe(8192);
  });
});

describe('parseModelsList — Anthropic', () => {
  const fixture = {
    data: [
      {
        id: 'claude-sonnet-4-6',
        type: 'model',
        display_name: 'Claude Sonnet 4.6',
        created_at: '2026-04-09T00:00:00Z',
        max_input_tokens: 1_000_000,
        max_tokens: 64_000,
        capabilities: {
          vision: true,
          thinking: true,
          structured_outputs: true,
          batch: true,
        },
      },
      {
        id: 'claude-haiku-4-5',
        type: 'model',
        display_name: 'Claude Haiku 4.5',
        max_input_tokens: 200_000,
        max_tokens: 64_000,
        capabilities: { vision: true, thinking: false },
      },
    ],
    first_id: 'claude-sonnet-4-6',
    last_id: 'claude-haiku-4-5',
    has_more: false,
  };

  it('extracts id, displayName, contextWindow, capabilities', () => {
    const out = parseModelsList('anthropic', fixture);
    expect(out).toHaveLength(2);
    const sonnet = out[0];
    expect(sonnet.id).toBe('claude-sonnet-4-6');
    expect(sonnet.displayName).toBe('Claude Sonnet 4.6');
    expect(sonnet.contextWindow).toBe(1_000_000);
    expect(sonnet.capabilities?.vision).toBe(true);
    expect(sonnet.capabilities?.reasoning).toBe(true);
    expect(sonnet.capabilities?.structuredOutput).toBe(true);
    const haiku = out[1];
    expect(haiku.capabilities?.reasoning).toBe(false);
  });

  it('preserves raw payload', () => {
    const out = parseModelsList('anthropic', fixture);
    expect(out[0].raw).toEqual(fixture.data[0]);
  });

  it('omits capabilities object when none of the known flags are present', () => {
    const out = parseModelsList('anthropic', {
      data: [{ id: 'claude-x', display_name: 'X' }],
    });
    expect(out[0].capabilities).toBeUndefined();
  });
});

describe('parseModelsList — Gemini', () => {
  const fixture = {
    models: [
      {
        name: 'models/gemini-2.5-pro',
        version: '001',
        displayName: 'Gemini 2.5 Pro',
        description: 'Best model for complex tasks',
        inputTokenLimit: 1_048_576,
        outputTokenLimit: 65_536,
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
        thinking: true,
      },
      {
        name: 'models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        inputTokenLimit: 1_048_576,
        outputTokenLimit: 65_536,
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      },
      {
        name: 'models/text-embedding-004',
        displayName: 'Text Embedding 004',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
  };

  it('strips the "models/" prefix from id', () => {
    const out = parseModelsList('gemini', fixture);
    const ids = out.map((m) => m.id);
    expect(ids).toContain('gemini-2.5-pro');
    expect(ids).toContain('gemini-2.5-flash');
  });

  it('filters out non-chat models (embedding, etc.)', () => {
    const out = parseModelsList('gemini', fixture);
    expect(out.map((m) => m.id)).not.toContain('text-embedding-004');
  });

  it('reads inputTokenLimit as contextWindow and thinking as reasoning', () => {
    const out = parseModelsList('gemini', fixture);
    const pro = out.find((m) => m.id === 'gemini-2.5-pro')!;
    expect(pro.contextWindow).toBe(1_048_576);
    expect(pro.capabilities?.reasoning).toBe(true);
  });
});

describe('parseModelsList — Cohere', () => {
  const fixture = {
    models: [
      {
        name: 'command-a-03-2025',
        endpoints: ['chat', 'generate'],
        context_length: 256_000,
        features: ['tools'],
        is_deprecated: false,
      },
      {
        name: 'command-r-plus',
        endpoints: ['chat'],
        context_length: 128_000,
        features: ['tools', 'vision'],
      },
      {
        name: 'embed-english-v3.0',
        endpoints: ['embed'],
        context_length: 512,
      },
    ],
  };

  it('extracts name as id and context_length as contextWindow', () => {
    const out = parseModelsList('cohere', fixture);
    const cmd = out.find((m) => m.id === 'command-a-03-2025')!;
    expect(cmd).toBeDefined();
    expect(cmd.contextWindow).toBe(256_000);
    expect(cmd.capabilities?.tools).toBe(true);
  });

  it('reads vision feature as capabilities.vision', () => {
    const out = parseModelsList('cohere', fixture);
    const rplus = out.find((m) => m.id === 'command-r-plus')!;
    expect(rplus.capabilities?.vision).toBe(true);
    expect(rplus.capabilities?.tools).toBe(true);
  });

  it('filters out non-chat endpoints (embed-only)', () => {
    const out = parseModelsList('cohere', fixture);
    expect(out.map((m) => m.id)).not.toContain('embed-english-v3.0');
  });
});

describe('parseModelsList — Ollama', () => {
  const fixture = {
    models: [
      {
        name: 'llama3.2:3b',
        model: 'llama3.2:3b',
        modified_at: '2026-04-15T22:50:35Z',
        size: 2_019_393_189,
        digest: 'abc123def456',
        details: {
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '3.2B',
          quantization_level: 'Q4_K_M',
        },
      },
      {
        name: 'qwen2.5:7b-instruct',
        model: 'qwen2.5:7b-instruct',
        modified_at: '2026-03-20T10:00:00Z',
        size: 4_700_000_000,
        digest: 'def789',
      },
    ],
  };

  it('extracts model tags from /api/tags', () => {
    const out = parseModelsList('ollama', fixture);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id)).toEqual(['llama3.2:3b', 'qwen2.5:7b-instruct']);
  });

  it('uses the tag as both id and displayName', () => {
    const out = parseModelsList('ollama', fixture);
    expect(out[0].id).toBe(out[0].displayName);
  });

  it('preserves the raw entry for advanced consumers', () => {
    const out = parseModelsList('ollama', fixture);
    expect(out[0].raw).toEqual(fixture.models[0]);
  });
});

describe('parseModelsList — error / edge cases', () => {
  it('returns [] for an unknown provider', () => {
    expect(parseModelsList('does-not-exist', { data: [{ id: 'x' }] })).toEqual([]);
  });

  it('returns [] for malformed body shapes (object missing the expected key)', () => {
    expect(parseModelsList('gemini', {})).toEqual([]);
    expect(parseModelsList('anthropic', { unrelated: true })).toEqual([]);
    expect(parseModelsList('cohere', { not_models: [] })).toEqual([]);
  });

  it('returns [] for null / undefined / non-objects', () => {
    expect(parseModelsList('openai', null)).toEqual([]);
    expect(parseModelsList('openai', undefined)).toEqual([]);
    expect(parseModelsList('openai', 'unexpected string')).toEqual([]);
  });
});
