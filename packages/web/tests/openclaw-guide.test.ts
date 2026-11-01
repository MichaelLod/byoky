import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The OpenClaw guide tells people to run `openclaw models set
// byoky-<provider>/<model>`. That only works for a model the plugin puts in
// OpenClaw's config, and only for an account that can call it.
const repo = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(repo, file), 'utf-8');
const PAGE = 'packages/web/app/openclaw/page.tsx';
const README = 'packages/openclaw-plugin/README.md';
const guide = [PAGE, 'packages/web/app/openclaw/InstallWithAI.tsx'];
const pluginSource = read('packages/openclaw-plugin/src/index.ts');
const pluginProviders = (JSON.parse(read('packages/openclaw-plugin/openclaw.plugin.json')) as {
  providers: string[];
}).providers;
// `byoky` is the wallet login itself; the others are the upstream providers.
const upstreamProviders = pluginProviders.filter((p) => p !== 'byoky');

// Google serves these only to projects that used them before
// (ai.google.dev/gemini-api/docs/models, checked 2026-11-01).
const PAST_USERS_ONLY = ['gemini-2.5-pro', 'gemini-2.5-flash'];

function guideModels(): Array<{ file: string; provider: string; model: string }> {
  return guide.flatMap((file) =>
    [...read(file).matchAll(/\b(byoky-[a-z_]+)\/([A-Za-z0-9][A-Za-z0-9.-]*)/g)]
      .filter(([, provider]) => pluginProviders.includes(provider))
      .map(([, provider, model]) => ({ file, provider, model })),
  );
}

// The display names the plugin's catalog gives each OpenClaw provider id.
function catalogNames(): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const [, list, body] of pluginSource.matchAll(/const (\w+_MODELS): ModelDef\[\] = \[([\s\S]*?)\];/g)) {
    lists.set(list, [...body.matchAll(/\bname: '([^']+)'/g)].map(([, name]) => name));
  }
  const byProvider = new Map<string, string[]>();
  for (const [, id, list] of pluginSource.matchAll(/\{ id: '(\w+)', name: '[^']+', api: '[^']+', basePath: '[^']*', models: (\w+) \}/g)) {
    byProvider.set(`byoky-${id}`, lists.get(list) ?? []);
  }
  return byProvider;
}

// The "Available providers" tables: the site's rows are
// ['Name', 'byoky-id', 'models', 'icon'], the README's `| Name | `byoky-id` | models |`.
function tableRows(file: string): Array<{ provider: string; models: string }> {
  const source = read(file);
  const rows =
    file === README
      ? source.matchAll(/^\| [^|]+ \| `(byoky-[a-z_]+)` \| ([^|]+) \|$/gm)
      : source.matchAll(/\['[^']+', '(byoky-[a-z_]+)', '([^']+)', '[^']+'\]/g);
  return [...rows].map(([, provider, models]) => ({ provider, models: models.trim() }));
}

// "Claude Opus 5.5, Sonnet 5.5" → ['Claude Opus 5.5', 'Claude Sonnet 5.5'];
// "Gemini 3.8 Flash (2.5 Pro and 2.5 Flash for past users)" → three names.
function namesIn(models: string, catalog: string[]): string[] {
  const parts = models
    .replace(/\bfor past users\b/g, '')
    .split(/,|\(|\)|\band\b/)
    .map((part) => part.trim())
    .filter(Boolean);
  const family = parts[0]?.split(' ')[0] ?? '';
  return parts.map((part) => (catalog.includes(part) || part.startsWith(`${family} `) ? part : `${family} ${part}`));
}

describe('the OpenClaw guide', () => {
  it('names models', () => {
    expect(guideModels().length).toBeGreaterThan(3);
  });

  it('suggests only models the plugin configures', () => {
    const missing = guideModels().filter(({ model }) => !pluginSource.includes(`id: '${model}'`));
    expect(missing).toEqual([]);
  });

  it('suggests no model new accounts cannot call', () => {
    expect(guideModels().filter(({ model }) => PAST_USERS_ONLY.includes(model))).toEqual([]);
  });
});

describe.each([PAGE, README])('the provider table in %s', (file) => {
  const catalog = catalogNames();

  it('lists every provider the plugin registers', () => {
    expect([...catalog.keys()].sort()).toEqual([...upstreamProviders].sort());
    expect(tableRows(file).map((row) => row.provider).sort()).toEqual([...upstreamProviders].sort());
  });

  it('gives the provider count the plugin registers', () => {
    const counts = [...read(file).matchAll(/registers all (\d+) Byoky providers/g)].map(([, n]) => Number(n));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts).toEqual(counts.map(() => upstreamProviders.length));
  });

  it("names exactly the catalog's models", () => {
    for (const { provider, models } of tableRows(file)) {
      const names = catalog.get(provider) ?? [];
      if (names.length === 0) {
        expect(models, provider).toMatch(/^Set /);
      } else {
        expect(new Set(namesIn(models, names)), provider).toEqual(new Set(names));
      }
    }
  });
});
