import { MODELS } from './models.js';

/**
 * Per-model price, expressed in USD per 1,000,000 tokens (the unit every
 * provider publishes on their pricing page). Kept deliberately small — only
 * the dimensions we bill on today. Extend (cached-input, batch, etc.) when a
 * budget/ledger needs finer granularity.
 */
export interface ModelPrice {
  /** USD per 1M input (prompt) tokens. */
  inputPerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number;
}

/**
 * Where a price came from, carried onto every priced request so the ledger
 * can prove how a cost was derived and so billing stays correct when prices
 * later change.
 */
export type PriceSource = 'feed' | 'fallback' | 'unknown';

export interface PricedRequest {
  costUsd: number;
  /** `${source}:${version}` — snapshot this onto the request_log row. */
  priceVersion: string;
  source: PriceSource;
}

/**
 * A resolved price for a model id, plus the version it came from. The vault
 * implements this over its `price_cache` table (fed by the external pricing
 * feed); pass it into `priceRequest` and this module falls back to the
 * hand-maintained table below when the feed has no entry.
 */
export type PriceLookup = (modelId: string) => (ModelPrice & { version?: string }) | undefined;

/**
 * Hand-maintained fallback price table. Source of truth is the external feed
 * (models.dev-style) cached in the vault DB; THIS exists only so a feed outage
 * never zeroes out cost/budget enforcement. Values are best-effort estimates
 * in USD / 1M tokens and WILL drift — the feed overrides them at runtime.
 *
 * Covers the models in `MODELS` (translation-relevant flagships). Unknown
 * models price at 0 with source 'unknown' (logged, never thrown).
 *
 * last verified (fallback estimates): 2026-07-11
 */
export const FALLBACK_PRICING: Record<string, ModelPrice> = {
  // ─── Anthropic ───────────────────────────────────────────────────────────
  'claude-opus-4-7': { inputPerMTok: 15, outputPerMTok: 75 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
  // ─── OpenAI ──────────────────────────────────────────────────────────────
  'gpt-5.5': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gpt-5.4': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gpt-5.4-mini': { inputPerMTok: 0.25, outputPerMTok: 2 },
  'gpt-5.4-nano': { inputPerMTok: 0.05, outputPerMTok: 0.4 },
  // ─── Google Gemini ───────────────────────────────────────────────────────
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  // ─── Cohere ──────────────────────────────────────────────────────────────
  'command-a-03-2025': { inputPerMTok: 2.5, outputPerMTok: 10 },
};

/** Bump when the fallback table above is edited (part of `priceVersion`). */
export const FALLBACK_PRICING_VERSION = '2026-07-11';

/**
 * Strip a trailing dated/snapshot suffix so `claude-haiku-4-5-20251001`
 * resolves against a `claude-haiku-4-5` entry (and vice-versa). Matches a
 * trailing `-YYYYMMDD` or `-\d{6,}` segment.
 */
function stripDateSuffix(modelId: string): string {
  return modelId.replace(/-\d{6,8}$/, '');
}

function lookupFallback(modelId: string): ModelPrice | undefined {
  const direct = FALLBACK_PRICING[modelId];
  if (direct) return direct;
  // try normalized (strip date suffix) in both directions
  const normalized = stripDateSuffix(modelId);
  if (normalized !== modelId && FALLBACK_PRICING[normalized]) return FALLBACK_PRICING[normalized];
  for (const key of Object.keys(FALLBACK_PRICING)) {
    if (stripDateSuffix(key) === normalized) return FALLBACK_PRICING[key];
  }
  return undefined;
}

/**
 * Compute the USD cost of a single request from its token counts.
 *
 * Pure. Resolves price via the injected `lookup` (feed-backed, from the vault
 * DB) first, then the hand-maintained fallback table, then gives up with a
 * zero cost tagged `unknown` so a missing price never breaks enforcement or
 * throws on the hot path. The returned `priceVersion` is snapshotted onto the
 * ledger row so historical costs stay correct when prices later change.
 */
export function priceRequest(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  lookup?: PriceLookup,
): PricedRequest {
  const inTok = Math.max(0, inputTokens || 0);
  const outTok = Math.max(0, outputTokens || 0);

  const fed = lookup?.(modelId);
  if (fed) {
    return {
      costUsd: cost(fed, inTok, outTok),
      priceVersion: `feed:${fed.version ?? 'unversioned'}`,
      source: 'feed',
    };
  }

  const fallback = lookupFallback(modelId);
  if (fallback) {
    return {
      costUsd: cost(fallback, inTok, outTok),
      priceVersion: `fallback:${FALLBACK_PRICING_VERSION}`,
      source: 'fallback',
    };
  }

  return { costUsd: 0, priceVersion: 'unknown', source: 'unknown' };
}

function cost(p: ModelPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok;
}

/**
 * Sanity check used by tests/CI: every model in the translation registry has
 * a fallback price. Guards against adding a model without a price (which would
 * silently bill at $0 on a feed outage).
 */
export function modelsMissingFallbackPrice(): string[] {
  return MODELS.filter((m) => !lookupFallback(m.id)).map((m) => m.id);
}
