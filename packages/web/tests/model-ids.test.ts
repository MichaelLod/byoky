import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Model ids the site must not tell anyone to use: shut down at the
// provider, so requests fail, or deprecated with a shutdown date. Checked
// 2026-11-01 against platform.claude.com/docs/en/about-claude/model-deprecations.
const OFF_LIMITS: Record<string, string> = {
  'claude-sonnet-4-5': 'deprecated, retires 2026-11-30; use claude-sonnet-5-5',
  'claude-sonnet-4-20250514': 'retired 2026-06-15',
  'claude-opus-4-20250514': 'retired 2026-06-15',
  'claude-opus-4-1': 'retired 2026-08-05',
  'claude-3-7-sonnet': 'retired 2026-02-19',
  'claude-3-5-sonnet': 'retired 2025-10-28',
  'claude-3-5-haiku': 'retired 2026-02-19',
  'claude-3-opus': 'retired 2026-01-05',
};

const appDir = join(__dirname, '..', 'app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|mdx?)$/.test(entry.name) ? [path] : [];
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('site model ids', () => {
  it('name no shut-down or deprecated models', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(appDir)) {
      const text = readFileSync(file, 'utf-8');
      for (const [id, why] of Object.entries(OFF_LIMITS)) {
        // The id itself or a dated snapshot of it, not a longer id.
        if (new RegExp(`(?<![\\w.-])${escape(id)}(?![\\w.])`).test(text)) {
          hits.push(`${relative(appDir, file)}: ${id} (${why})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
