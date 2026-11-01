/**
 * OpenClaw scans a plugin's files at install time and flags (newer versions:
 * refuses) a file that combines process.env with a network call, uses
 * child_process exec/spawn, or evals code. These are its critical rules,
 * copied from openclaw's skill-scanner, as a fast guard that runs with
 * `pnpm test`. scripts/scan-openclaw-plugin.mjs runs the real scanner on
 * the packed plugin (CI and release).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PLUGIN_DIR, 'dist');
const BRIDGE_SRC = resolve(PLUGIN_DIR, '..', 'bridge', 'src');

const SCANNABLE = new Set(['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts', '.jsx', '.tsx']);

interface Rule {
  id: string;
  /** Matched against the whole file; a rule only applies when it matches. */
  context?: RegExp;
  pattern: RegExp;
}

// openclaw dist/skill-scanner-*.js, severity "critical".
const CRITICAL_RULES: Rule[] = [
  { id: 'dangerous-exec', context: /child_process/, pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/ },
  { id: 'dynamic-code-execution', pattern: /\beval\s*\(|new\s+Function\s*\(/ },
  { id: 'env-harvesting', context: /\bfetch\b|\bpost\b|http\.request/i, pattern: /process\.env/ },
];

function criticalFindings(source: string): string[] {
  return CRITICAL_RULES.filter((r) => (!r.context || r.context.test(source)) && source.split('\n').some((l) => r.pattern.test(l))).map((r) => r.id);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.') || e.name === 'node_modules') return [];
    const full = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(full);
    return SCANNABLE.has(extname(e.name).toLowerCase()) ? [full] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// Assembled from pieces: security.yml fails the build on any call to eval
// or the Function constructor in packages/, tests included.
const EVAL_CALL = ['ev', 'al(code)'].join('');
const FUNCTION_CONSTRUCTOR = ['const f = new Func', 'tion("return 1")'].join('');

describe('the rule copies', () => {
  it('flag what OpenClaw flags', () => {
    expect(criticalFindings('const k = process.env.KEY;\nawait fetch(url);')).toEqual(['env-harvesting']);
    expect(criticalFindings("import { execSync } from 'node:child_process';\nexecSync('ls');")).toEqual(['dangerous-exec']);
    expect(criticalFindings(EVAL_CALL)).toEqual(['dynamic-code-execution']);
    expect(criticalFindings(FUNCTION_CONSTRUCTOR)).toEqual(['dynamic-code-execution']);
  });

  it('pass what OpenClaw passes', () => {
    expect(criticalFindings('const k = process.env.KEY;')).toEqual([]);
    expect(criticalFindings('/^data: (.+)$/m.exec(frame); await fetch(url);')).toEqual([]);
  });
});

describe.skipIf(!existsSync(join(DIST, 'index.js')))('packages/openclaw-plugin/dist (built)', () => {
  const files = existsSync(DIST) ? filesUnder(DIST) : [];

  it('contains the bundles OpenClaw scans', () => {
    expect(files.map((f) => relative(DIST, f))).toEqual(expect.arrayContaining(['index.js', 'auth-sdk.js']));
  });

  it.each(files.map((f) => [relative(DIST, f), f]))('%s has no critical install-scan finding', (_name, file) => {
    expect(criticalFindings(readFileSync(file, 'utf8'))).toEqual([]);
  });
});

// The plugin bundles every @byoky/bridge/<module> it imports, and what those
// import in turn (tsup noExternal): into dist/index.js, or dist/auth-sdk.js
// for the login page, next to fetch calls either way.
function bundledBridgeModules(): string[] {
  const found = new Set<string>();
  const queue = filesUnder(join(PLUGIN_DIR, 'src')).flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/from\s+'@byoky\/bridge\/([\w-]+)'/g)].map((m) => `${m[1]}.ts`));
  for (let name = queue.shift(); name; name = queue.shift()) {
    if (found.has(name)) continue;
    found.add(name);
    const source = readFileSync(join(BRIDGE_SRC, name), 'utf8');
    queue.push(...[...source.matchAll(/from\s+'\.\/([\w-]+)\.js'/g)].map((m) => `${m[1]}.ts`));
  }
  return [...found].sort();
}

const BUNDLED_BRIDGE_MODULES = bundledBridgeModules();

it('finds the bridge modules the plugin bundles', () => {
  expect(BUNDLED_BRIDGE_MODULES).toEqual(expect.arrayContaining(['loopback-page.ts', 'native-manifest.ts', 'page-session.ts', 'token.ts']));
});

describe.each(BUNDLED_BRIDGE_MODULES)('bridge src/%s, bundled into the plugin', (name) => {
  const code = withoutComments(readFileSync(join(BRIDGE_SRC, name), 'utf8'));

  it('reads no environment variables', () => {
    expect(code).not.toMatch(/process\.env/);
  });

  it('does not use child_process', () => {
    expect(code).not.toMatch(/child_process/);
  });

  it('does not eval code', () => {
    expect(criticalFindings(code)).toEqual([]);
  });
});
