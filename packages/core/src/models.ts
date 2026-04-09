import type { ProviderId, CapabilitySet, RequestLogEntry } from './types.js';

export type { CapabilitySet } from './types.js';

/**
 * Model registry for translation-aware routing.
 *
 * This is the source of truth for which models exist, what family they belong
 * to, and what they can do. It's used by:
 *  - the translation layer, to pick a destination model when a group has none
 *    pinned and to validate capability gaps before forwarding a request
 *  - the popup, to surface model choice in the group editor and to warn the
 *    user at drag-time when an app's history uses features the destination
 *    model doesn't support
 *
 * IMPORTANT: this list is hardcoded by hand. It is intentionally narrow —
 * only models that translation actually needs to reason about. Other models
 * still work for pass-through (no translation) requests; they just can't be
 * the *destination* of a translated request.
 *
 * last verified: 2026-04-09
 *  - Anthropic: docs.anthropic.com/en/docs/about-claude/models/overview
 *  - OpenAI:    developers.openai.com/api/docs/models
 */

/**
 * The dialect a model speaks at the API surface. Two models in the same
 * family can substitute for each other without translation; two models in
 * different families require the translation layer to bridge them.
 */
export type ModelFamily = 'anthropic' | 'openai';

export interface ModelCapabilities {
  /** Function/tool calling. */
  tools: boolean;
  /** Forced tool selection (`tool_choice: required` / `{type: tool, name}`). */
  toolChoice: boolean;
  /** Multiple tool calls in a single turn. */
  parallelToolCalls: boolean;
  /** Image inputs. */
  vision: boolean;
  /** JSON-schema-constrained outputs (OpenAI `response_format: json_schema`). */
  structuredOutput: boolean;
  /** Accepts a top-level system prompt. */
  systemPrompt: boolean;
  /** Streaming responses (SSE). */
  streaming: boolean;
  /** Anthropic-style extended thinking / OpenAI o-series reasoning. */
  reasoning: boolean;
}

export interface ModelEntry {
  /** Exact API model id. */
  id: string;
  /** Provider this model is hosted on. */
  providerId: ProviderId;
  /** API dialect family — determines whether translation is needed. */
  family: ModelFamily;
  /** Human-readable label for UI. */
  displayName: string;
  /** Maximum input context window in tokens. */
  contextWindow: number;
  /** Maximum tokens the model can produce in a single response. */
  maxOutput: number;
  capabilities: ModelCapabilities;
}

/**
 * Capability preset for "modern frontier model with everything turned on".
 * Used to keep entries below from drifting in their defaults.
 */
const FRONTIER: ModelCapabilities = {
  tools: true,
  toolChoice: true,
  parallelToolCalls: true,
  vision: true,
  structuredOutput: true,
  systemPrompt: true,
  streaming: true,
  reasoning: true,
};

export const MODELS: ModelEntry[] = [
  // ─── Anthropic ───────────────────────────────────────────────────────────
  {
    id: 'claude-opus-4-6',
    providerId: 'anthropic',
    family: 'anthropic',
    displayName: 'Claude Opus 4.6',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    capabilities: FRONTIER,
  },
  {
    id: 'claude-sonnet-4-6',
    providerId: 'anthropic',
    family: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    capabilities: FRONTIER,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    providerId: 'anthropic',
    family: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutput: 64_000,
    capabilities: FRONTIER,
  },

  // ─── OpenAI ──────────────────────────────────────────────────────────────
  {
    id: 'gpt-5.4',
    providerId: 'openai',
    family: 'openai',
    displayName: 'GPT-5.4',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    capabilities: FRONTIER,
  },
  {
    id: 'gpt-5.4-mini',
    providerId: 'openai',
    family: 'openai',
    displayName: 'GPT-5.4 mini',
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: FRONTIER,
  },
  {
    id: 'gpt-5.4-nano',
    providerId: 'openai',
    family: 'openai',
    displayName: 'GPT-5.4 nano',
    contextWindow: 400_000,
    maxOutput: 128_000,
    capabilities: {
      ...FRONTIER,
      // The nano variant is text-only at the chat-completions surface.
      vision: false,
    },
  },
];

/**
 * Default destination model per family. Used when a group routes across
 * families and the user hasn't pinned a specific model on the group.
 *
 * Pick the family flagship: highest-capability, broadest context, full feature
 * set. The mini/nano variants are not defaults — users can opt in explicitly.
 */
export const DEFAULT_MODELS: Record<ModelFamily, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5.4',
};

/**
 * Look up a model by its exact API id. Returns undefined for unknown ids
 * (which is fine for pass-through requests — translation just won't activate).
 */
export function getModel(id: string): ModelEntry | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * List all known models for a given provider.
 */
export function modelsForProvider(providerId: ProviderId): ModelEntry[] {
  return MODELS.filter((m) => m.providerId === providerId);
}

/**
 * List all known models for a given family.
 */
export function modelsForFamily(family: ModelFamily): ModelEntry[] {
  return MODELS.filter((m) => m.family === family);
}

/**
 * The set of capability flags an app actually used in past requests, derived
 * from inspecting the request bodies. Used by the popup to compare against a
 * candidate destination model and surface drag-time warnings.
 *
 * Defined in types.ts (re-exported above) so RequestLogEntry can reference
 * it without a circular import. Kept intentionally narrow: only the
 * capabilities that matter for the Anthropic↔OpenAI translation surface in
 * v0.5.0. Extending this requires updating both detectRequestCapabilities
 * and an entry in ModelCapabilities.
 */
export const EMPTY_CAPABILITY_SET: CapabilitySet = {
  tools: false,
  vision: false,
  structuredOutput: false,
  reasoning: false,
};

/**
 * Diff a set of capabilities the app has used against a destination model.
 * Returns the list of capability names the model lacks. Empty array means the
 * model satisfies everything the app has needed so far.
 */
export function capabilityGaps(used: CapabilitySet, model: ModelEntry): (keyof CapabilitySet)[] {
  const gaps: (keyof CapabilitySet)[] = [];
  if (used.tools && !model.capabilities.tools) gaps.push('tools');
  if (used.vision && !model.capabilities.vision) gaps.push('vision');
  if (used.structuredOutput && !model.capabilities.structuredOutput) gaps.push('structuredOutput');
  if (used.reasoning && !model.capabilities.reasoning) gaps.push('reasoning');
  return gaps;
}

/**
 * Aggregate capability usage across a list of request log entries. Walks
 * each entry's `usedCapabilities` (set at log time by detectRequestCapabilities)
 * and OR-merges them into a single CapabilitySet describing everything the
 * app has needed across its history.
 *
 * Used by the popup at drag-time to compare against a candidate destination
 * model — if any used capability is missing from the model, surface a warning
 * before confirming the group reassignment.
 */
export function detectAppCapabilities(entries: RequestLogEntry[]): CapabilitySet {
  const out: CapabilitySet = {
    tools: false,
    vision: false,
    structuredOutput: false,
    reasoning: false,
  };
  for (const e of entries) {
    const used = e.usedCapabilities;
    if (!used) continue;
    if (used.tools) out.tools = true;
    if (used.vision) out.vision = true;
    if (used.structuredOutput) out.structuredOutput = true;
    if (used.reasoning) out.reasoning = true;
  }
  return out;
}

/**
 * Human-readable label for a capability key. Used in warning messages.
 */
export function capabilityLabel(key: keyof CapabilitySet): string {
  switch (key) {
    case 'tools':
      return 'tool calling';
    case 'vision':
      return 'image inputs';
    case 'structuredOutput':
      return 'structured outputs';
    case 'reasoning':
      return 'extended reasoning';
  }
}
