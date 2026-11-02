// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The site's tsconfig keeps JSX for Next (`jsx: preserve`), which Vite can't
// load, so compile the component here.
function loadVersionStatus(): () => React.ReactElement | null {
  const source = readFileSync(resolve(__dirname, '../app/components/VersionStatus.tsx'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const modules: Record<string, unknown> = { react: React, 'react/jsx-runtime': jsxRuntime };
  const exports: { VersionStatus?: () => React.ReactElement | null } = {};
  new Function('require', 'exports', outputText)((id: string) => modules[id], exports);
  return exports.VersionStatus!;
}
const VersionStatus = loadVersionStatus();
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
