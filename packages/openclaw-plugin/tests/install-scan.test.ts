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

describe('the rule copies', () => {
  it('flag what OpenClaw flags', () => {
    expect(criticalFindings('const k = process.env.KEY;\nawait fetch(url);')).toEqual(['env-harvesting']);
    expect(criticalFindings("import { execSync } from 'node:child_process';\nexecSync('ls');")).toEqual(['dangerous-exec']);
    expect(criticalFindings('eval(code)')).toEqual(['dynamic-code-execution']);
    expect(criticalFindings('const f = new Function("return 1")')).toEqual(['dynamic-code-execution']);
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

// The plugin bundles these two bridge modules (tsup noExternal), so they end
// up in dist/index.js next to the plugin's fetch calls.
describe.each(['token.ts', 'native-manifest.ts'])('bridge src/%s, bundled into the plugin', (name) => {
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
