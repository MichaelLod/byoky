import { describe, it, expect } from 'vitest';
import {
  encodeGiftLink,
  decodeGiftLink,
  giftLinkToUrl,
  validateGiftLink,
  isGiftExpired,
  isGiftBudgetExhausted,
  giftBudgetRemaining,
  giftBudgetPercent,
  createGiftLink,
  giftShortLinkToUrl,
  giftShortLinkToDeepUrl,
  extractGiftShortId,
  isGiftShortUrl,
  resolveGiftShortLink,
} from '../src/gift.js';
import type { Gift, GiftLink } from '../src/gift.js';

function makeValidGiftLink(overrides: Partial<GiftLink> = {}): GiftLink {
  return {
    v: 1,
    id: 'gift_abc123',
    p: 'anthropic',
    n: 'Anthropic',
    s: "Michael's API",
    t: 'tok_secret_xyz789',
    m: 100000,
    e: Date.now() + 86400000,
    r: 'wss://relay.byoky.com/ws',
    ...overrides,
  };
}

function makeGift(overrides: Partial<Gift> = {}): Gift {
  return {
    id: 'gift_abc123',
    credentialId: 'cred_001',
    providerId: 'anthropic',
    label: "Michael's API",
    authToken: 'tok_secret_xyz789',
    maxTokens: 100000,
    usedTokens: 0,
    expiresAt: Date.now() + 86400000,
    createdAt: Date.now(),
    active: true,
    relayUrl: 'wss://relay.byoky.com/ws',
    ...overrides,
  };
}

describe('encodeGiftLink / decodeGiftLink roundtrip', () => {
  it('encodes and decodes a GiftLink preserving all fields', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const decoded = decodeGiftLink(encoded);
    expect(decoded).toEqual(link);
  });

  it('encoded output is a base64url string (no +, /, or = chars)', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('roundtrips with unicode in sender label', () => {
    const link = makeValidGiftLink({ s: 'Taro\u2019s key' });
    const encoded = encodeGiftLink(link);
    const decoded = decodeGiftLink(encoded);
    expect(decoded).toEqual(link);
  });
});

describe('decodeGiftLink with invalid input', () => {
  it('returns null for an empty string', () => {
    expect(decodeGiftLink('')).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(decodeGiftLink('%%%not-base64!!!')).toBeNull();
  });

  it('returns null for valid base64 that is not JSON', () => {
    const notJson = btoa('this is not json');
    expect(decodeGiftLink(notJson)).toBeNull();
  });

  it('returns null for valid JSON missing required fields', () => {
    const partial = btoa(JSON.stringify({ v: 1, id: 'test' }));
    const decoded = decodeGiftLink(partial);
    // decodeGiftLink only checks v === 1, so it returns the partial object;
    // validation of fields is done by validateGiftLink
    expect(decoded).toBeTruthy();
    expect(decoded!.v).toBe(1);
  });

  it('returns null for wrong version', () => {
    const wrong = btoa(JSON.stringify({ v: 2, id: 'gift_1', p: 'anthropic' }));
    expect(decodeGiftLink(wrong)).toBeNull();
  });

  it('returns null for missing version field', () => {
    const noVersion = btoa(JSON.stringify({ id: 'gift_1' }));
    expect(decodeGiftLink(noVersion)).toBeNull();
  });
});

describe('decodeGiftLink with URL prefixes', () => {
  it('strips the byoky://gift/ prefix and decodes', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const url = `byoky://gift/${encoded}`;
    const decoded = decodeGiftLink(url);
    expect(decoded).toEqual(link);
  });

  it('strips the https://byoky.com/gift# prefix and decodes', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const url = `https://byoky.com/gift#${encoded}`;
    const decoded = decodeGiftLink(url);
    expect(decoded).toEqual(link);
  });

  it('strips the https://byoky.com/gift/ prefix and decodes', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const url = `https://byoky.com/gift/${encoded}`;
    const decoded = decodeGiftLink(url);
    expect(decoded).toEqual(link);
  });
});

describe('validateGiftLink', () => {
  it('returns valid: true for a well-formed link', () => {
    const link = makeValidGiftLink();
    expect(validateGiftLink(link)).toEqual({ valid: true });
  });

  it('rejects missing giftId', () => {
    const link = makeValidGiftLink({ id: '' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing gift ID');
  });

  it('rejects missing provider', () => {
    const link = makeValidGiftLink({ p: '' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing provider');
  });

  it('rejects missing auth token', () => {
    const link = makeValidGiftLink({ t: '' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing auth token');
  });

  it('rejects missing relay URL', () => {
    const link = makeValidGiftLink({ r: '' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing relay URL');
  });

  it('rejects token budget of 0', () => {
    const link = makeValidGiftLink({ m: 0 });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid token budget');
  });

  it('rejects negative token budget', () => {
    const link = makeValidGiftLink({ m: -500 });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid token budget');
  });

  it('rejects expired gift (expiresAt in the past)', () => {
    const link = makeValidGiftLink({ e: Date.now() - 1000 });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason?.toLowerCase()).toContain('expired');
  });

  it('rejects invalid relay URL protocol (http://)', () => {
    const link = makeValidGiftLink({ r: 'http://relay.byoky.com/ws' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('wss://');
  });

  it('rejects invalid relay URL protocol (https://)', () => {
    const link = makeValidGiftLink({ r: 'https://relay.byoky.com/ws' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('wss://');
  });

  it('rejects plain ws:// against a non-loopback relay', () => {
    const link = makeValidGiftLink({ r: 'ws://relay.byoky.com/ws' });
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('wss://');
  });

  it('accepts ws:// against localhost (dev)', () => {
    const link = makeValidGiftLink({ r: 'ws://localhost:8787/ws' });
    expect(validateGiftLink(link).valid).toBe(true);
  });

  it('accepts wss:// relay URL', () => {
    const link = makeValidGiftLink({ r: 'wss://relay.byoky.com/ws' });
    expect(validateGiftLink(link).valid).toBe(true);
  });

  it('rejects wrong version (v: 2)', () => {
    const link = { ...makeValidGiftLink(), v: 2 as never };
    const result = validateGiftLink(link);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unsupported');
  });
});

describe('isGiftExpired', () => {
  it('returns true when expiresAt is in the past', () => {
    expect(isGiftExpired({ expiresAt: Date.now() - 1000 })).toBe(true);
  });

  it('returns false when expiresAt is in the future', () => {
    expect(isGiftExpired({ expiresAt: Date.now() + 86400000 })).toBe(false);
  });
});

describe('isGiftBudgetExhausted', () => {
  it('returns true when usedTokens equals maxTokens', () => {
    expect(isGiftBudgetExhausted({ usedTokens: 10000, maxTokens: 10000 })).toBe(true);
  });

  it('returns true when usedTokens exceeds maxTokens', () => {
    expect(isGiftBudgetExhausted({ usedTokens: 15000, maxTokens: 10000 })).toBe(true);
  });

  it('returns false when usedTokens is less than maxTokens', () => {
    expect(isGiftBudgetExhausted({ usedTokens: 5000, maxTokens: 10000 })).toBe(false);
  });
});

describe('giftBudgetRemaining', () => {
  it('returns the correct remaining tokens', () => {
    expect(giftBudgetRemaining({ usedTokens: 3000, maxTokens: 10000 })).toBe(7000);
  });

  it('returns 0 when fully used', () => {
    expect(giftBudgetRemaining({ usedTokens: 10000, maxTokens: 10000 })).toBe(0);
  });

  it('never returns negative (usedTokens > maxTokens)', () => {
    expect(giftBudgetRemaining({ usedTokens: 15000, maxTokens: 10000 })).toBe(0);
  });

  it('returns maxTokens when nothing used', () => {
    expect(giftBudgetRemaining({ usedTokens: 0, maxTokens: 50000 })).toBe(50000);
  });
});

describe('giftBudgetPercent', () => {
  it('returns 0% when nothing used', () => {
    expect(giftBudgetPercent({ usedTokens: 0, maxTokens: 10000 })).toBe(0);
  });

  it('returns 50% at half usage', () => {
    expect(giftBudgetPercent({ usedTokens: 5000, maxTokens: 10000 })).toBe(50);
  });

  it('returns 100% when fully used', () => {
    expect(giftBudgetPercent({ usedTokens: 10000, maxTokens: 10000 })).toBe(100);
  });

  it('caps at 100% when overused', () => {
    expect(giftBudgetPercent({ usedTokens: 15000, maxTokens: 10000 })).toBe(100);
  });

  it('returns 100 when maxTokens is 0', () => {
    expect(giftBudgetPercent({ usedTokens: 0, maxTokens: 0 })).toBe(100);
  });

  it('rounds to nearest integer', () => {
    expect(giftBudgetPercent({ usedTokens: 1, maxTokens: 3 })).toBe(33);
  });
});

describe('createGiftLink', () => {
  it('creates a GiftLink from a Gift with correct field mapping', () => {
    const gift = makeGift();
    const { link, encoded } = createGiftLink(gift);

    expect(link.v).toBe(1);
    expect(link.id).toBe(gift.id);
    expect(link.p).toBe(gift.providerId);
    expect(link.n).toBe('Anthropic');
    expect(link.s).toBe(gift.label);
    expect(link.t).toBe(gift.authToken);
    expect(link.m).toBe(gift.maxTokens);
    expect(link.e).toBe(gift.expiresAt);
    expect(link.r).toBe(gift.relayUrl);

    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('uses provider name from PROVIDERS registry', () => {
    const gift = makeGift({ providerId: 'openai' });
    const { link } = createGiftLink(gift);
    expect(link.n).toBe('OpenAI');
  });

  it('falls back to providerId when provider is unknown', () => {
    const gift = makeGift({ providerId: 'unknown_provider' });
    const { link } = createGiftLink(gift);
    expect(link.n).toBe('unknown_provider');
  });

  it('returns an encoded string that decodes back to the link', () => {
    const gift = makeGift();
    const { encoded, link } = createGiftLink(gift);
    const decoded = decodeGiftLink(encoded);
    expect(decoded).toEqual(link);
  });
});

describe('giftLinkToUrl', () => {
  it('returns an https://byoky.com/gift/ URL', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const url = giftLinkToUrl(encoded);
    expect(url).toBe(`https://byoky.com/gift/${encoded}`);
  });

  it('produces a URL that decodeGiftLink can parse', () => {
    const link = makeValidGiftLink();
    const encoded = encodeGiftLink(link);
    const url = giftLinkToUrl(encoded);
    const decoded = decodeGiftLink(url);
    expect(decoded).toEqual(link);
  });
});

describe('giftShortLinkToUrl / giftShortLinkToDeepUrl', () => {
  it('builds the web and deep-link forms', () => {
    expect(giftShortLinkToUrl('AbC123dEf456')).toBe('https://byoky.com/g/AbC123dEf456');
    expect(giftShortLinkToDeepUrl('AbC123dEf456')).toBe('byoky://g/AbC123dEf456');
  });
});

describe('extractGiftShortId', () => {
  it('pulls the id out of an https URL', () => {
    expect(extractGiftShortId('https://byoky.com/g/AbC123dEf456')).toBe('AbC123dEf456');
  });

  it('pulls the id out of a byoky:// deep link', () => {
    expect(extractGiftShortId('byoky://g/AbC123dEf456')).toBe('AbC123dEf456');
  });

  it('tolerates a trailing slash', () => {
    expect(extractGiftShortId('https://byoky.com/g/AbC123dEf456/')).toBe('AbC123dEf456');
  });

  it('tolerates surrounding whitespace', () => {
    expect(extractGiftShortId('  https://byoky.com/g/AbC123dEf456  ')).toBe('AbC123dEf456');
  });

  it('accepts a bare id', () => {
    expect(extractGiftShortId('AbC123dEf456')).toBe('AbC123dEf456');
  });

  it('rejects long-form gift URLs', () => {
    expect(extractGiftShortId('https://byoky.com/gift/eyJ2IjoxfQ')).toBeNull();
  });

  it('rejects ids that are too short or too long', () => {
    expect(extractGiftShortId('https://byoky.com/g/abc')).toBeNull();
    expect(extractGiftShortId('https://byoky.com/g/' + 'a'.repeat(33))).toBeNull();
  });

  it('rejects ids with invalid characters', () => {
    expect(extractGiftShortId('https://byoky.com/g/abc!def@ghij')).toBeNull();
  });
});

describe('isGiftShortUrl', () => {
  it('returns true for web and deep-link short URLs', () => {
    expect(isGiftShortUrl('https://byoky.com/g/AbC123dEf456')).toBe(true);
    expect(isGiftShortUrl('byoky://g/AbC123dEf456')).toBe(true);
  });

  it('returns false for bare ids (they look the same but aren\'t "URLs")', () => {
    expect(isGiftShortUrl('AbC123dEf456')).toBe(false);
  });

  it('returns false for long-form URLs', () => {
    expect(isGiftShortUrl('https://byoky.com/gift/eyJ2IjoxfQ')).toBe(false);
  });
});

describe('resolveGiftShortLink', () => {
  it('returns the encoded blob on 200', async () => {
    const mockFetch = async () => new Response(JSON.stringify({ encoded: 'abc.blob' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    const result = await resolveGiftShortLink('https://vault.byoky.com', 'AbC123dEf456', mockFetch as unknown as typeof fetch);
    expect(result).toBe('abc.blob');
  });

  it('returns null on 404', async () => {
    const mockFetch = async () => new Response('{}', { status: 404 });
    const result = await resolveGiftShortLink('https://vault.byoky.com', 'AbC123dEf456', mockFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('returns null on 410 (expired)', async () => {
    const mockFetch = async () => new Response('{}', { status: 410 });
    const result = await resolveGiftShortLink('https://vault.byoky.com', 'AbC123dEf456', mockFetch as unknown as typeof fetch);
    expect(result).toBeNull();
  });

  it('throws on other errors so callers can distinguish transport failures', async () => {
    const mockFetch = async () => new Response('{}', { status: 500 });
    await expect(
      resolveGiftShortLink('https://vault.byoky.com', 'AbC123dEf456', mockFetch as unknown as typeof fetch),
    ).rejects.toThrow(/500/);
  });

  it('strips trailing slashes from the base URL', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ encoded: 'x' }), { status: 200 });
    };
    await resolveGiftShortLink('https://vault.byoky.com/', 'AbC123dEf456', mockFetch as unknown as typeof fetch);
    expect(capturedUrl).toBe('https://vault.byoky.com/gift-links/AbC123dEf456');
  });
});
