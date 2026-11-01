import { describe, it, expect } from 'vitest';
import {
  buildManifest,
  HOST_NAME,
  PUBLISHED_EXTENSION_ID,
  UNPACKED_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
} from '../src/native-manifest.js';

describe('buildManifest', () => {
  it('allows only the Web Store build in Chromium browsers by default', () => {
    expect(buildManifest('/x/byoky-bridge-host', 'chrome')).toEqual({
      name: HOST_NAME,
      description: 'Byoky Bridge — native messaging host',
      path: '/x/byoky-bridge-host',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${PUBLISHED_EXTENSION_ID}/`],
    });
  });

  it('adds the unpacked build with dev', () => {
    const m = buildManifest('/x', 'chrome', { dev: true }) as { allowed_origins: string[] };
    expect(m.allowed_origins).toEqual([
      `chrome-extension://${PUBLISHED_EXTENSION_ID}/`,
      `chrome-extension://${UNPACKED_EXTENSION_ID}/`,
    ]);
  });

  it('replaces the Web Store ID with a custom one', () => {
    const m = buildManifest('/x', 'chrome', { extensionId: 'abcdefghijklmnopabcdefghijklmnop' }) as { allowed_origins: string[] };
    expect(m.allowed_origins).toEqual(['chrome-extension://abcdefghijklmnopabcdefghijklmnop/']);
  });

  it('allows the Firefox add-on by its ID', () => {
    const m = buildManifest('/x', 'firefox', { dev: true }) as Record<string, unknown>;
    expect(m.allowed_extensions).toEqual([FIREFOX_EXTENSION_ID]);
    expect(m).not.toHaveProperty('allowed_origins');
  });
});
