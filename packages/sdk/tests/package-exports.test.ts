// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

// Both packages are "type": "module". A flat `types` condition points
// require() at the ESM .d.ts too, and a CommonJS TypeScript project under
// module node16 then fails with TS1479. Each condition needs its own types.
const PACKAGES = ['sdk', 'core'];

type Conditions = Record<'import' | 'require', { types: string; default: string }>;

function readManifest(pkg: string) {
  return JSON.parse(readFileSync(resolve(__dirname, `../../${pkg}/package.json`), 'utf-8'));
}

describe.each(PACKAGES)('@byoky/%s exports', (pkg) => {
  const manifest = readManifest(pkg);

  it('gives import and require their own types', () => {
    const entries = Object.entries(manifest.exports as Record<string, Record<string, unknown>>);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, conditions] of entries) {
      expect(Object.keys(conditions)).toEqual(['import', 'require']);
      const { import: esm, require: cjs } = conditions as Conditions;
      expect(esm.types).toMatch(/\.d\.ts$/);
      expect(esm.default).toMatch(/\.js$/);
      expect(cjs.types).toMatch(/\.d\.cts$/);
      expect(cjs.default).toMatch(/\.cjs$/);
      // `types` comes first in each, as TypeScript requires.
      expect(Object.keys(esm)[0]).toBe('types');
      expect(Object.keys(cjs)[0]).toBe('types');
    }
  });

  // moduleResolution node10 (what `module: commonjs` implies) ignores
  // `exports`; a subpath has types there only through typesVersions.
  it('maps every subpath export in typesVersions for node10', () => {
    const subpaths = Object.keys(manifest.exports).filter((key) => key !== '.');
    const mapped = (manifest.typesVersions?.['*'] ?? {}) as Record<string, string[]>;
    for (const key of subpaths) {
      expect(mapped[key.slice(2)]).toEqual([(manifest.exports[key] as Conditions).require.types]);
    }
    expect(Object.keys(mapped).sort()).toEqual(subpaths.map((key) => key.slice(2)).sort());
  });
});

describe('@byoky/sdk types under each moduleResolution', () => {
  // The published package as a consumer sees it: the real manifest, with
  // empty declaration files where the build puts them.
  // Resolved paths come back real (macOS's tmpdir is a symlink).
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'byoky-types-')));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const manifest = readManifest('sdk');
  const pkgDir = join(root, 'node_modules/@byoky/sdk');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(manifest));
  for (const conditions of Object.values(manifest.exports as Record<string, Conditions>)) {
    for (const file of [conditions.import.types, conditions.require.types]) writeFileSync(join(pkgDir, file), 'export {};\n');
  }
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app/package.json'), '{"type":"commonjs"}');

  function resolveFrom(file: string, specifier: string, options: ts.CompilerOptions): string | undefined {
    // The import's module format, as TypeScript gets it from a .cts or .mts file.
    const mode = file.endsWith('.cts') ? ts.ModuleKind.CommonJS : file.endsWith('.mts') ? ts.ModuleKind.ESNext : undefined;
    const resolved = ts.resolveModuleName(specifier, join(root, 'app', file), options, ts.sys, undefined, undefined, mode).resolvedModule;
    return resolved && resolved.resolvedFileName.slice(pkgDir.length + 1);
  }

  it.each([
    ['node10 (module commonjs)', 'index.ts', { module: ts.ModuleKind.CommonJS }, 'dist/index.d.ts', 'dist/server.d.cts'],
    ['node10', 'index.ts', { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 }, 'dist/index.d.ts', 'dist/server.d.cts'],
    ['node16, CommonJS file', 'index.cts', { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 }, 'dist/index.d.cts', 'dist/server.d.cts'],
    ['node16, ESM file', 'index.mts', { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 }, 'dist/index.d.ts', 'dist/server.d.ts'],
    ['bundler', 'index.ts', { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }, 'dist/index.d.ts', 'dist/server.d.ts'],
  ] as const)('%s finds both entry points', (_label, file, options, root, server) => {
    expect(resolveFrom(file, '@byoky/sdk', options)).toBe(root);
    expect(resolveFrom(file, '@byoky/sdk/server', options)).toBe(server);
  });
});
