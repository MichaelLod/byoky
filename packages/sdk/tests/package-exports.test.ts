// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Both packages are "type": "module". A flat `types` condition points
// require() at the ESM .d.ts too, and a CommonJS TypeScript project under
// module node16 then fails with TS1479. Each condition needs its own types.
const PACKAGES = ['sdk', 'core'];

describe.each(PACKAGES)('@byoky/%s exports', (pkg) => {
  const manifest = JSON.parse(readFileSync(resolve(__dirname, `../../${pkg}/package.json`), 'utf-8'));

  it('gives import and require their own types', () => {
    const entries = Object.entries(manifest.exports as Record<string, Record<string, unknown>>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, conditions] of entries) {
      expect(Object.keys(conditions)).toEqual(['import', 'require']);
      const { import: esm, require: cjs } = conditions as Record<string, { types: string; default: string }>;
      expect(esm.types).toMatch(/\.d\.ts$/);
      expect(esm.default).toMatch(/\.js$/);
      expect(cjs.types).toMatch(/\.d\.cts$/);
      expect(cjs.default).toMatch(/\.cjs$/);
      // `types` comes first in each, as TypeScript requires.
      expect(Object.keys(esm)[0]).toBe('types');
      expect(Object.keys(cjs)[0]).toBe('types');
    }
  });
});
