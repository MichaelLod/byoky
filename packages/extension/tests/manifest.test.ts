import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from '../wxt.config';

/**
 * The manifest WXT writes for `browser`, as far as the config shapes it:
 * transformManifest, then the build:manifestGenerated hook.
 */
function generatedManifest(browser: string, manifest: Record<string, unknown>): Record<string, any> {
  const m = structuredClone(manifest);
  config.transformManifest?.(m as never);
  const hook = (config.hooks as Record<string, unknown> | undefined)?.['build:manifestGenerated'];
  if (typeof hook === 'function') hook({ config: { browser } }, m);
  return m;
}

const MV2_BACKGROUND = { background: { scripts: ['background.js'] } };

describe('manifest', () => {
  it('keeps the description within the Safari (App Store) limit of 112 characters', () => {
    const manifest = config.manifest as { description?: string };
    expect(typeof manifest.description).toBe('string');
    expect(manifest.description!.length).toBeLessThanOrEqual(112);
  });

  it('names no other brand (stores block crypto-wallet impersonation)', () => {
    const manifest = config.manifest as { description?: string };
    expect(manifest.description).not.toMatch(/metamask/i);
  });

  // F001: every MV2 build was marked non-persistent, so Firefox suspended
  // the background 30 s into a long request or a connect left for the user.
  it('keeps the Firefox background page persistent and makes only Safari\'s non-persistent', () => {
    expect(generatedManifest('firefox', MV2_BACKGROUND).background).not.toHaveProperty('persistent');
    // Safari on iOS requires a non-persistent page.
    expect(generatedManifest('safari', MV2_BACKGROUND).background).toEqual({ scripts: ['background.js'], persistent: false });
    expect(generatedManifest('chrome', { background: { service_worker: 'background.js' } }).background)
      .toEqual({ service_worker: 'background.js' });
  });

  it('leaves the side panel permission and the key to Chrome', () => {
    const base = { permissions: ['storage', 'sidePanel', 'nativeMessaging', 'alarms'], key: 'MIIB-test' };
    for (const browser of ['firefox', 'safari']) {
      const m = generatedManifest(browser, base);
      expect(m.permissions, browser).toEqual(['storage', 'nativeMessaging', 'alarms']);
      expect(m, browser).not.toHaveProperty('key');
    }
    expect(generatedManifest('chrome', base)).toMatchObject(base);
  });

  // F056: apps detect Byoky by the window.__byoky__ that provider.js defines
  // in the page's own world. A content script's world: 'MAIN' needs Firefox
  // 128 and Safari 18 (iOS 18; macOS 13 is the oldest that gets Safari 18).
  // Older versions installed Byoky, ran the script in the isolated world,
  // and every app said Byoky was not installed.
  it('asks for browsers that run the MAIN-world content script', async () => {
    vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
    const scripts = await Promise.all([
      import('../entrypoints/provider.content'),
      import('../entrypoints/content'),
    ]).finally(() => vi.unstubAllGlobals());
    const mainWorld = scripts.some((m) => (m.default as { world?: string }).world === 'MAIN');
    expect(mainWorld).toBe(true);

    const gecko = (config.manifest as { browser_specific_settings: { gecko: { strict_min_version: string } } })
      .browser_specific_settings.gecko;
    expect(parseFloat(gecko.strict_min_version)).toBeGreaterThanOrEqual(128);

    // The Safari extension targets (packages/ios/project.yml).
    const project = readFileSync(fileURLToPath(new URL('../../ios/project.yml', import.meta.url)), 'utf-8');
    const target = (name: string) => {
      const block = project.split(/\n(?=  \S)/).find((b) => b.startsWith(`  ${name}:`));
      return parseFloat(/deploymentTarget: "([\d.]+)"/.exec(block ?? '')?.[1] ?? '0');
    };
    expect(target('ByokySafariExtension')).toBeGreaterThanOrEqual(18);
    expect(target('ByokySafariExtension (macOS)')).toBeGreaterThanOrEqual(13);
    expect(target('Byoky (macOS)')).toBeGreaterThanOrEqual(13);
  });
});
