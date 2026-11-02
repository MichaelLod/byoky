import { describe, it, expect } from 'vitest';
import { parseTokenLimit } from '../entrypoints/popup/utils/token-limit';

// F015: parseInt read "1e6" as a 1-token cap and dropped 0 (meant to block an
// app) as no limit; a field that doesn't hold a number must never become
// "no limit", nor some other number.
describe('parseTokenLimit', () => {
  it('reads an empty field as no limit', () => {
    expect(parseTokenLimit('')).toBeNull();
    expect(parseTokenLimit('   ')).toBeNull();
  });

  it('reads whole numbers, 0 included', () => {
    expect(parseTokenLimit('100000')).toBe(100_000);
    expect(parseTokenLimit(' 2500 ')).toBe(2500);
    expect(parseTokenLimit('0')).toBe(0);
    expect(parseTokenLimit('007')).toBe(7);
  });

  it('reads digits grouped by a thousands separator', () => {
    expect(parseTokenLimit('100,000')).toBe(100_000);
    expect(parseTokenLimit('1.000.000')).toBe(1_000_000);
    expect(parseTokenLimit('50 000')).toBe(50_000);
    expect(parseTokenLimit("1'000'000")).toBe(1_000_000);
    expect(parseTokenLimit('1_000')).toBe(1000);
    expect(parseTokenLimit('3,000,000,000')).toBe(3_000_000_000);
  });

  it('refuses anything else instead of reading another number from it', () => {
    for (const raw of ['1e6', '1.5e5', '-5', '+5', '2.9', '1.5', '1,00', '1,000.000', '10,0000', 'abc', '100k', '0x10', 'Infinity', '1 000,000']) {
      expect(parseTokenLimit(raw), raw).toBe('invalid');
    }
  });

  it('caps a huge number where usage counts stop', () => {
    expect(parseTokenLimit('99999999999999999999')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
