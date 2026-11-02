import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import config from '../wxt.config';

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

  // F070: an untitled page is named by its URL in the window Safari (and
  // Chrome, as a last resort) opens for a connection request. WXT also makes
  // the title the toolbar button's and the Firefox sidebar's default_title.
  it.each(['popup', 'sidepanel'])('titles the %s page Byoky', (page) => {
    const html = readFileSync(new URL(`../entrypoints/${page}/index.html`, import.meta.url), 'utf8');
    expect(html).toMatch(/<head>[\s\S]*<title>Byoky<\/title>[\s\S]*<\/head>/);
  });
});
