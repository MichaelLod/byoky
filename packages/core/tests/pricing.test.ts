import { describe, it, expect } from 'vitest';
import {
  priceRequest,
  modelsMissingFallbackPrice,
  FALLBACK_PRICING,
  FALLBACK_PRICING_VERSION,
  type PriceLookup,
} from '../src/pricing.js';

// ── priceRequest: fallback table ────────────────────────

describe('priceRequest — fallback table', () => {
  it('prices a known model from the fallback table', () => {
    // claude-sonnet-4-6: 3 / 15 per 1M
    const r = priceRequest('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(r.costUsd).toBeCloseTo(18, 6);
    expect(r.source).toBe('fallback');
    expect(r.priceVersion).toBe(`fallback:${FALLBACK_PRICING_VERSION}`);
  });

  it('scales linearly with token counts', () => {
    // 3 per 1M input → 500k input = 1.5; 15 per 1M output → 200k = 3.0
    const r = priceRequest('claude-sonnet-4-6', 500_000, 200_000);
    expect(r.costUsd).toBeCloseTo(1.5 + 3.0, 6);
  });

  it('resolves a dated snapshot id against a bare fallback key', () => {
    // fallback has claude-haiku-4-5-20251001; a bare id should still resolve
    const bare = priceRequest('claude-haiku-4-5', 1_000_000, 0);
    expect(bare.source).toBe('fallback');
    expect(bare.costUsd).toBeCloseTo(1, 6);
  });

  it('resolves a bare key against a dated fallback entry', () => {
    const dated = priceRequest('claude-haiku-4-5-20251001', 0, 1_000_000);
    expect(dated.source).toBe('fallback');
    expect(dated.costUsd).toBeCloseTo(5, 6);
  });
});

// ── priceRequest: feed lookup wins ──────────────────────

describe('priceRequest — feed lookup', () => {
  const feed: PriceLookup = (id) =>
    id === 'claude-sonnet-4-6'
      ? { inputPerMTok: 2, outputPerMTok: 8, version: '2026-07-10' }
      : undefined;

  it('prefers the feed price over the fallback', () => {
    const r = priceRequest('claude-sonnet-4-6', 1_000_000, 1_000_000, feed);
    expect(r.costUsd).toBeCloseTo(10, 6); // 2 + 8, not 3 + 15
    expect(r.source).toBe('feed');
    expect(r.priceVersion).toBe('feed:2026-07-10');
  });

  it('falls back to the table when the feed lacks the model', () => {
    const r = priceRequest('gpt-5.5', 1_000_000, 0, feed);
    expect(r.source).toBe('fallback');
    expect(r.costUsd).toBeCloseTo(1.25, 6);
  });

  it('tags feed prices with no version as unversioned', () => {
    const noVer: PriceLookup = () => ({ inputPerMTok: 1, outputPerMTok: 1 });
    const r = priceRequest('anything', 1_000_000, 0, noVer);
    expect(r.priceVersion).toBe('feed:unversioned');
  });
});

// ── priceRequest: unknown + hardening ───────────────────

describe('priceRequest — unknown & hardening', () => {
  it('returns zero cost tagged unknown for an unpriced model (never throws)', () => {
    const r = priceRequest('some-obscure-local-model', 1_000_000, 1_000_000);
    expect(r.costUsd).toBe(0);
    expect(r.source).toBe('unknown');
    expect(r.priceVersion).toBe('unknown');
  });

  it('clamps negative / NaN token counts to zero', () => {
    const r = priceRequest('claude-sonnet-4-6', -5, Number.NaN);
    expect(r.costUsd).toBe(0);
    expect(r.source).toBe('fallback');
  });
});

// ── registry coverage guard ─────────────────────────────

describe('fallback coverage', () => {
  it('every translation-registry model has a fallback price', () => {
    expect(modelsMissingFallbackPrice()).toEqual([]);
  });

  it('all fallback prices are positive and finite', () => {
    for (const [id, p] of Object.entries(FALLBACK_PRICING)) {
      expect(p.inputPerMTok, id).toBeGreaterThan(0);
      expect(p.outputPerMTok, id).toBeGreaterThan(0);
      expect(Number.isFinite(p.inputPerMTok), id).toBe(true);
      expect(Number.isFinite(p.outputPerMTok), id).toBe(true);
    }
  });
});
