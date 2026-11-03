// @vitest-environment jsdom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
// vitest compiles the site's JSX itself (vitest.config.ts), so the
// component is imported as is.
import { VersionStatus } from '../app/components/VersionStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** Renders VersionStatus with this versions.json and returns its container. */
async function render(chrome: { version: string; status: string; pending?: string }): Promise<HTMLElement> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    local: '1.1.1',
    native: '1.1.1',
    generatedAt: '2026-11-02T00:00:00Z',
    platforms: [{ platform: 'Chrome', ...chrome }],
  }))));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await React.act(async () => {
    root.render(React.createElement(VersionStatus));
  });
  await vi.waitFor(() => expect(container.textContent).toContain('Chrome'));
  return container;
}

const sourceLink = (el: HTMLElement) => el.querySelector('a[href*="INSTALL.md"]');

describe('VersionStatus', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) React.act(() => root.unmount());
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('sends nobody to a source install while the Chrome store version is current', async () => {
    // A source install is a separate, empty wallet with no auto-updates: only
    // worth it while a newer version waits in review.
    const el = await render({ version: '1.1.1', status: 'live' });
    expect(sourceLink(el)).toBeNull();
  });

  it('offers the source install while a Chrome version is pending review', async () => {
    const el = await render({ version: '1.1.1', status: 'live', pending: '1.1.2' });
    expect(sourceLink(el)?.textContent).toContain('v1.1.2 pending review');
  });
});
