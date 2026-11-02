import { describe, it, expect } from 'vitest';
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
});
