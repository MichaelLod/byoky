import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ByokyErrorCode, isByokyErrorCode } from '../src/types.js';

const ROOT = resolve(__dirname, '../../..');

// Every error code the extension can hand a page has to be a ByokyErrorCode,
// or apps can't match it and the SDK reports it as UNKNOWN.
const EMITTERS = [
  'packages/extension/entrypoints/background.ts',
  'packages/extension/entrypoints/content.ts',
];

describe('ByokyErrorCode', () => {
  it.each(EMITTERS)('covers every code literal in %s', (path) => {
    const source = readFileSync(resolve(ROOT, path), 'utf-8');
    const codes = [...source.matchAll(/\bcode:\s*'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((code) => !isByokyErrorCode(code))).toEqual([]);
  });

  it('isByokyErrorCode accepts the enum values only', () => {
    expect(isByokyErrorCode(ByokyErrorCode.WALLET_LOCKED)).toBe(true);
    expect(isByokyErrorCode('WALLET_RELOADED')).toBe(true);
    expect(isByokyErrorCode('NO_CREDENTIAL')).toBe(false);
    expect(isByokyErrorCode('wallet_locked')).toBe(false);
    expect(isByokyErrorCode(undefined)).toBe(false);
    expect(isByokyErrorCode(42)).toBe(false);
  });
});
