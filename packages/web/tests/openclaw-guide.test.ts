import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The OpenClaw guide tells people to run `openclaw models set
// byoky-<provider>/<model>`. That only works for a model the plugin puts in
// OpenClaw's config, and only for an account that can call it.
const repo = join(__dirname, '..', '..', '..');
const guide = ['packages/web/app/openclaw/page.tsx', 'packages/web/app/openclaw/InstallWithAI.tsx'];
const pluginSource = readFileSync(join(repo, 'packages/openclaw-plugin/src/index.ts'), 'utf-8');
const pluginProviders = (JSON.parse(readFileSync(join(repo, 'packages/openclaw-plugin/openclaw.plugin.json'), 'utf-8')) as {
  providers: string[];
}).providers;

// Google serves these only to projects that used them before
// (ai.google.dev/gemini-api/docs/models, checked 2026-11-01).
const PAST_USERS_ONLY = ['gemini-2.5-pro', 'gemini-2.5-flash'];

function guideModels(): Array<{ file: string; provider: string; model: string }> {
  return guide.flatMap((file) =>
    [...readFileSync(join(repo, file), 'utf-8').matchAll(/\b(byoky-[a-z_]+)\/([A-Za-z0-9][A-Za-z0-9.-]*)/g)]
      .filter(([, provider]) => pluginProviders.includes(provider))
      .map(([, provider, model]) => ({ file, provider, model })),
  );
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
