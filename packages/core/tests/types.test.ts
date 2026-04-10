import { describe, it, expect } from 'vitest';
import type { TokenAllowance, RequestLogEntry } from '../src/types.js';

describe('TokenAllowance', () => {
  it('supports total limit only', () => {
    const allowance: TokenAllowance = {
      origin: 'https://example.com',
      totalLimit: 100_000,
    };
    expect(allowance.origin).toBe('https://example.com');
    expect(allowance.totalLimit).toBe(100_000);
    expect(allowance.providerLimits).toBeUndefined();
  });

  it('supports per-provider limits', () => {
    const allowance: TokenAllowance = {
      origin: 'https://example.com',
      providerLimits: {
        openai: 50_000,
        anthropic: 30_000,
      },
    };
    expect(allowance.providerLimits?.openai).toBe(50_000);
    expect(allowance.providerLimits?.anthropic).toBe(30_000);
  });

  it('supports both total and per-provider limits', () => {
    const allowance: TokenAllowance = {
      origin: 'https://example.com',
      totalLimit: 100_000,
      providerLimits: { openai: 50_000 },
    };
    expect(allowance.totalLimit).toBe(100_000);
    expect(allowance.providerLimits?.openai).toBe(50_000);
  });

  it('allows unlimited when no limits set', () => {
    const allowance: TokenAllowance = {
      origin: 'https://example.com',
    };
    expect(allowance.totalLimit).toBeUndefined();
    expect(allowance.providerLimits).toBeUndefined();
  });
});

describe('TokenAllowance enforcement logic', () => {
  function checkAllowance(
    allowance: TokenAllowance | undefined,
    entries: Pick<RequestLogEntry, 'appOrigin' | 'providerId' | 'inputTokens' | 'outputTokens' | 'status'>[],
    providerId: string,
  ): { allowed: boolean; reason?: string } {
    if (!allowance) return { allowed: true };

    const origin = allowance.origin;
    const filtered = entries.filter((e) => e.appOrigin === origin && e.status < 400);

    let totalUsed = 0;
    const byProvider: Record<string, number> = {};
    for (const entry of filtered) {
      const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
      totalUsed += tokens;
      byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
    }

    if (allowance.totalLimit != null && totalUsed >= allowance.totalLimit) {
      return { allowed: false, reason: `Token allowance exceeded for ${origin}` };
    }

    const providerLimit = allowance.providerLimits?.[providerId];
    if (providerLimit != null && (byProvider[providerId] ?? 0) >= providerLimit) {
      return { allowed: false, reason: `Token allowance for ${providerId} exceeded` };
    }

    return { allowed: true };
  }

  const origin = 'https://byoky.com';

  it('allows when no allowance configured', () => {
    expect(checkAllowance(undefined, [], 'openai')).toEqual({ allowed: true });
  });

  it('allows when under total limit', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 10_000 };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 1000, outputTokens: 500, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('blocks when total limit exceeded', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 1000 };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 600, outputTokens: 500, status: 200 },
    ];
    const result = checkAllowance(allowance, entries, 'openai');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeded');
  });

  it('allows when under provider limit', () => {
    const allowance: TokenAllowance = { origin, providerLimits: { openai: 5000 } };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 1000, outputTokens: 500, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('blocks when provider limit exceeded', () => {
    const allowance: TokenAllowance = { origin, providerLimits: { openai: 1000 } };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 600, outputTokens: 500, status: 200 },
    ];
    const result = checkAllowance(allowance, entries, 'openai');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('openai');
  });

  it('allows different provider when only one is limited', () => {
    const allowance: TokenAllowance = { origin, providerLimits: { openai: 1000 } };
    const entries = [
      { appOrigin: origin, providerId: 'anthropic', inputTokens: 5000, outputTokens: 5000, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'anthropic')).toEqual({ allowed: true });
  });

  it('ignores failed requests in usage calculation', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 1000 };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 5000, outputTokens: 5000, status: 500 },
      { appOrigin: origin, providerId: 'openai', inputTokens: 100, outputTokens: 50, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('ignores usage from other origins', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 1000 };
    const entries = [
      { appOrigin: 'https://other.com', providerId: 'openai', inputTokens: 5000, outputTokens: 5000, status: 200 },
      { appOrigin: origin, providerId: 'openai', inputTokens: 100, outputTokens: 50, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('sums across multiple entries', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 2000 };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 300, outputTokens: 200, status: 200 },
      { appOrigin: origin, providerId: 'anthropic', inputTokens: 300, outputTokens: 200, status: 200 },
    ];
    expect(checkAllowance(allowance, entries, 'openai')).toEqual({ allowed: true });
  });

  it('total limit checked before provider limit', () => {
    const allowance: TokenAllowance = { origin, totalLimit: 500, providerLimits: { openai: 10_000 } };
    const entries = [
      { appOrigin: origin, providerId: 'openai', inputTokens: 300, outputTokens: 300, status: 200 },
    ];
    const result = checkAllowance(allowance, entries, 'openai');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(origin);
  });
});
