import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Model ids the site must not tell anyone to use: shut down at the
// provider, so requests fail, or deprecated with a shutdown date. Checked
// 2026-11-01 against the deprecation pages:
//   platform.claude.com/docs/en/about-claude/model-deprecations
//   developers.openai.com/api/docs/deprecations
//   ai.google.dev/gemini-api/docs/deprecations
//   docs.cohere.com/docs/deprecations
// An entry matches the id and its dated snapshots, not longer ids.
const OFF_LIMITS: Record<string, string> = {
  'claude-sonnet-4-5': 'deprecated, retires 2026-11-30; use claude-sonnet-5-5',
  'claude-sonnet-4-20250514': 'retired 2026-06-15',
  'claude-opus-4-20250514': 'retired 2026-06-15',
  'claude-opus-4-1': 'retired 2026-08-05',
  'claude-3-7-sonnet': 'retired 2026-02-19',
  'claude-3-5-sonnet': 'retired 2025-10-28',
  'claude-3-5-haiku': 'retired 2026-02-19',
  'claude-3-opus': 'retired 2026-01-05',
  'gpt-4o': 'deprecated, shutdown 2027-01-14',
  'gpt-4o-mini': 'deprecated, shutdown 2027-01-14',
  'gpt-4.1': 'deprecated, shutdown 2027-01-14',
  'gpt-5-mini': 'deprecated, shutdown 2026-12-11',
  'gpt-5.4-nano': 'deprecated, shutdown 2027-04-01',
  'gemini-2.0-flash': 'shut down 2026-06-01',
  'gemini-3-pro-preview': 'shut down 2026-03-09',
  'gemini-3.1-flash-lite-preview': 'shut down 2026-05-25',
  'command-r-plus': 'the alias of command-r-plus-04-2024, deprecated 2025-09-15',
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
        if (new RegExp(`(?<![\\w.-])${escape(id)}(?![\\w.]|-(?!\\d{8}\\b|\\d{4}-\\d{2}-\\d{2}\\b))`).test(text)) {
          hits.push(`${relative(appDir, file)}: ${id} (${why})`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
