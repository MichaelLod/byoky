/**
 * Per-provider model discovery.
 *
 * Apps that want a model picker call `session.listModels(providerId)` in the
 * SDK; that thin wrapper proxies a GET to the right upstream endpoint and
 * feeds the response into `parseModelsList()` here. The result is a uniform
 * `ModelInfo[]` regardless of which provider answered.
 *
 * Providers fall into a small number of response shapes:
 *  - openai-data:    {data: [{id, ...}], object: "list"}
 *                    used by openai, deepseek, mistral, groq, fireworks,
 *                    lm_studio, openrouter, xai, azure_openai
 *  - anthropic-data: {data: [{id, display_name, max_input_tokens, ...}]}
 *  - gemini-models:  {models: [{name: "models/...", inputTokenLimit, ...}]}
 *  - cohere-models:  {models: [{name, context_length, features, ...}]}
 *  - together-array: [{id, display_name, context_length, ...}]    (no wrapper)
 *  - ollama-tags:    {models: [{name, size, details, ...}]}
 *  - perplexity:     no endpoint — hardcoded list (see PERPLEXITY_MODELS)
 */

import type { ModelCapabilities } from './models.js';

export interface ModelInfo {
  /** Exact model ID to use in the API call. */
  id: string;
  /** Provider this model is hosted on. */
  providerId: string;
  /** Human-readable label. Falls back to `id` if the provider doesn't supply one. */
  displayName?: string;
  /** Maximum input context window in tokens, when known. */
  contextWindow?: number;
  /**
   * Best-effort capability flags. Some providers expose these directly
   * (Anthropic, Gemini, Mistral, Cohere); others return only an ID, in which
   * case this field is undefined and the caller can lookup against the
   * static MODELS registry in models.ts.
   */
  capabilities?: Partial<ModelCapabilities>;
  /** Provider-specific raw payload — useful for advanced consumers. */
  raw: unknown;
}

/** Endpoint description for fetching a model list. */
export interface ListModelsEndpoint {
  /** Path relative to the provider's `baseUrl`. */
  path: string;
  /** HTTP method (currently always GET). */
  method: 'GET';
  /** Extra request headers required by the provider (e.g. anthropic-version). */
  headers?: Record<string, string>;
}

const ENDPOINTS: Record<string, ListModelsEndpoint> = {
  openai: { path: '/v1/models', method: 'GET' },
  anthropic: {
    path: '/v1/models',
    method: 'GET',
    headers: { 'anthropic-version': '2023-06-01' },
  },
  gemini: { path: '/v1beta/models', method: 'GET' },
  mistral: { path: '/v1/models', method: 'GET' },
  cohere: { path: '/v1/models', method: 'GET' },
  xai: { path: '/v1/models', method: 'GET' },
  deepseek: { path: '/models', method: 'GET' },
  groq: { path: '/openai/v1/models', method: 'GET' },
  together: { path: '/v1/models', method: 'GET' },
  fireworks: { path: '/inference/v1/models', method: 'GET' },
  openrouter: { path: '/v1/models', method: 'GET' },
  azure_openai: { path: '/openai/models?api-version=2024-10-21', method: 'GET' },
  ollama: { path: '/api/tags', method: 'GET' },
  lm_studio: { path: '/v1/models', method: 'GET' },
};

/**
 * Look up the upstream models endpoint for a provider. Returns null for
 * providers that don't expose one (perplexity) — the caller should call
 * `getStaticModelsList(providerId)` instead.
 */
export function getListModelsEndpoint(providerId: string): ListModelsEndpoint | null {
  return ENDPOINTS[providerId] ?? null;
}

/**
 * Hardcoded model list for Perplexity's Sonar family. Updated 2026-04 from
 * https://docs.perplexity.ai. Perplexity has no public model-list endpoint.
 */
const PERPLEXITY_MODELS: ModelInfo[] = [
  {
    id: 'sonar',
    providerId: 'perplexity',
    displayName: 'Sonar',
    contextWindow: 128_000,
    raw: null,
  },
  {
    id: 'sonar-pro',
    providerId: 'perplexity',
    displayName: 'Sonar Pro',
    contextWindow: 200_000,
    raw: null,
  },
  {
    id: 'sonar-reasoning',
    providerId: 'perplexity',
    displayName: 'Sonar Reasoning',
    contextWindow: 128_000,
    capabilities: { reasoning: true },
    raw: null,
  },
  {
    id: 'sonar-reasoning-pro',
    providerId: 'perplexity',
    displayName: 'Sonar Reasoning Pro',
    contextWindow: 128_000,
    capabilities: { reasoning: true },
    raw: null,
  },
  {
    id: 'sonar-deep-research',
    providerId: 'perplexity',
    displayName: 'Sonar Deep Research',
    contextWindow: 128_000,
    capabilities: { reasoning: true },
    raw: null,
  },
];

/**
 * Returns a hardcoded model list for providers without a discovery endpoint.
 * Currently only perplexity. For everyone else, returns an empty array — use
 * `getListModelsEndpoint` + `parseModelsList` instead.
 */
export function getStaticModelsList(providerId: string): ModelInfo[] {
  if (providerId === 'perplexity') return PERPLEXITY_MODELS.slice();
  return [];
}

// ─── Parsing ───────────────────────────────────────────────────────────────

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function parseOpenAiData(providerId: string, body: unknown): ModelInfo[] {
  const root = asRecord(body);
  const data = root ? asArray(root.data) : asArray(body);
  const out: ModelInfo[] = [];
  for (const entry of data) {
    const m = asRecord(entry);
    if (!m) continue;
    const id = asString(m.id);
    if (!id) continue;
    out.push({
      id,
      providerId,
      displayName: asString(m.display_name) ?? asString(m.name),
      contextWindow:
        asNumber(m.context_length) ?? asNumber(m.context_window) ?? asNumber(m.max_context_length),
      raw: entry,
    });
  }
  return out;
}

function parseAnthropic(providerId: string, body: unknown): ModelInfo[] {
  const root = asRecord(body);
  if (!root) return [];
  const out: ModelInfo[] = [];
  for (const entry of asArray(root.data)) {
    const m = asRecord(entry);
    if (!m) continue;
    const id = asString(m.id);
    if (!id) continue;
    const caps = asRecord(m.capabilities);
    const capabilities: Partial<ModelCapabilities> = {};
    if (caps) {
      const vision = asBool(caps.vision) ?? asBool(caps.image_input);
      if (vision !== undefined) capabilities.vision = vision;
      const thinking = asBool(caps.thinking) ?? asBool(caps.reasoning);
      if (thinking !== undefined) capabilities.reasoning = thinking;
      const structured = asBool(caps.structured_outputs);
      if (structured !== undefined) capabilities.structuredOutput = structured;
    }
    out.push({
      id,
      providerId,
      displayName: asString(m.display_name),
      contextWindow: asNumber(m.max_input_tokens),
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
      raw: entry,
    });
  }
  return out;
}

function parseGemini(providerId: string, body: unknown): ModelInfo[] {
  const root = asRecord(body);
  if (!root) return [];
  const out: ModelInfo[] = [];
  for (const entry of asArray(root.models)) {
    const m = asRecord(entry);
    if (!m) continue;
    const fullName = asString(m.name);
    if (!fullName) continue;
    // Gemini returns `name: "models/gemini-2.5-pro"`. Apps want the raw id.
    const id = fullName.startsWith('models/') ? fullName.slice('models/'.length) : fullName;
    const methods = asArray(m.supportedGenerationMethods)
      .filter((s): s is string => typeof s === 'string');
    // Skip embedding-only / non-chat models so the picker stays useful.
    if (methods.length > 0 && !methods.includes('generateContent')) continue;
    const capabilities: Partial<ModelCapabilities> = {};
    const thinking = asBool(m.thinking);
    if (thinking !== undefined) capabilities.reasoning = thinking;
    out.push({
      id,
      providerId,
      displayName: asString(m.displayName),
      contextWindow: asNumber(m.inputTokenLimit),
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
      raw: entry,
    });
  }
  return out;
}

function parseCohere(providerId: string, body: unknown): ModelInfo[] {
  const root = asRecord(body);
  if (!root) return [];
  const out: ModelInfo[] = [];
  for (const entry of asArray(root.models)) {
    const m = asRecord(entry);
    if (!m) continue;
    const id = asString(m.name);
    if (!id) continue;
    // Cohere lists embedding/rerank models too — filter to chat-capable ones.
    const endpoints = asArray(m.endpoints).filter((s): s is string => typeof s === 'string');
    if (endpoints.length > 0 && !endpoints.includes('chat')) continue;
    const features = asArray(m.features).filter((s): s is string => typeof s === 'string');
    const capabilities: Partial<ModelCapabilities> = {};
    if (features.includes('tools')) capabilities.tools = true;
    if (features.includes('vision') || features.includes('image_input')) capabilities.vision = true;
    out.push({
      id,
      providerId,
      contextWindow: asNumber(m.context_length),
      capabilities: Object.keys(capabilities).length > 0 ? capabilities : undefined,
      raw: entry,
    });
  }
  return out;
}

function parseOllama(providerId: string, body: unknown): ModelInfo[] {
  const root = asRecord(body);
  if (!root) return [];
  const out: ModelInfo[] = [];
  for (const entry of asArray(root.models)) {
    const m = asRecord(entry);
    if (!m) continue;
    const id = asString(m.name) ?? asString(m.model);
    if (!id) continue;
    const details = asRecord(m.details);
    out.push({
      id,
      providerId,
      displayName: id,
      // Ollama's tags endpoint doesn't return context length — left undefined.
      raw: entry,
      ...(details && asString(details.parameter_size)
        ? {} // size info goes in raw; not surfaced as a top-level field
        : {}),
    });
  }
  return out;
}

const PARSERS: Record<string, (providerId: string, body: unknown) => ModelInfo[]> = {
  // OpenAI-compatible {data: [...]} shape (also covers plain-array providers
  // like Together — parseOpenAiData falls back to treating the body as an
  // array when no .data wrapper is present).
  openai: parseOpenAiData,
  mistral: parseOpenAiData,
  xai: parseOpenAiData,
  deepseek: parseOpenAiData,
  groq: parseOpenAiData,
  together: parseOpenAiData,
  fireworks: parseOpenAiData,
  openrouter: parseOpenAiData,
  azure_openai: parseOpenAiData,
  lm_studio: parseOpenAiData,
  // Custom shapes
  anthropic: parseAnthropic,
  gemini: parseGemini,
  cohere: parseCohere,
  ollama: parseOllama,
};

/**
 * Normalize an upstream model-list response into a ModelInfo[]. Returns an
 * empty array if the body is malformed or the provider isn't recognized.
 *
 * For perplexity (no endpoint), use `getStaticModelsList('perplexity')`.
 */
export function parseModelsList(providerId: string, body: unknown): ModelInfo[] {
  const parser = PARSERS[providerId];
  if (!parser) return [];
  return parser(providerId, body);
}
