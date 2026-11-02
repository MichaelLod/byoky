import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { showsInTab } from '../entrypoints/popup/utils/surface';

const popupDir = resolve(__dirname, '../entrypoints/popup');
const read = (p: string) => readFileSync(resolve(popupDir, p), 'utf8');

/** The first top-level rule for `selector`, as written in App.css. */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
}

describe('popup.html sizing as a toolbar popup (F006)', () => {
  // A popup sized from its content can't take its size from the viewport:
  // with vh sizing Chrome settles on a 320x25 strip (measured with
  // chrome.action.openPopup on the built extension).
  it('marks popup.html, and only popup.html, as a toolbar popup', () => {
    expect(read('index.html')).toMatch(/<html lang="en" class="popup">/);
    expect(read('../sidepanel/index.html')).not.toContain('popup');
  });

  it('gives the toolbar popup a fixed size, not one in vh', () => {
    const css = read('App.css');
    for (const selector of ['html.popup body', 'html.popup .app']) {
      const r = rule(css, selector);
      expect(r).toMatch(/height: 600px/);
      expect(r).not.toMatch(/vh/);
    }
    expect(rule(css, 'html.popup body')).toMatch(/width: 360px/);
  });

  it('drops the fixed size when the browser says the page is in a tab', () => {
    expect(read('main.tsx')).toMatch(/showsInTab\(window, getViews\)\) \{\s*document\.documentElement\.classList\.remove\('popup'\)/);
  });
});

describe('showsInTab: toolbar popup or a window of its own (F006)', () => {
  // The background opens plain popup.html in a 400x600 window on Firefox,
  // Safari and Chrome without a tab id. Kept at 360x600 there, the page showed
  // a 360px column with 600px of content in a 400x568 viewport (Chromium).
  const self = {} as Window;
  const other = {} as Window;
  const views = (popup: Window[], tab: Window[]) =>
    (filter: { type: 'popup' | 'tab' }) => (filter.type === 'popup' ? popup : tab);

  it('is false for the toolbar popup', () => {
    expect(showsInTab(self, views([self], [other]))).toBe(false);
  });

  it('is true for a tab or a popup window', () => {
    expect(showsInTab(self, views([], [other, self]))).toBe(true);
    // Another wallet popup being open elsewhere doesn't make this one a popup.
    expect(showsInTab(self, views([other], [self]))).toBe(true);
  });

  it('keeps the fixed size when the browser cannot say', () => {
    expect(showsInTab(self, undefined)).toBe(false);
    expect(showsInTab(self, views([], []))).toBe(false);
    expect(showsInTab(self, () => { throw new Error('unsupported'); })).toBe(false);
  });
});

describe('wide side panel keeps one centered column (F126)', () => {
  // body, the add sheet and the + button share one column width. The sheet
  // and the button are fixed to the viewport, so the column is centered and
  // the button follows its right edge (measured at 560x900 in Chrome: body,
  // sheet 70..490, + button right edge at 470).
  it('centers the column and lines the + button up with it', () => {
    const css = read('App.css');
    expect(rule(css, 'body')).toMatch(/max-width: var\(--column-max\);/);
    expect(rule(css, 'body')).toMatch(/margin: 0 auto;/);
    expect(rule(css, '.modal-sheet')).toMatch(/max-width: var\(--column-max\);/);
    expect(rule(css, '.fab-root')).toMatch(/right: max\(20px, calc\(\(100vw - var\(--column-max\)\) \/ 2 \+ 20px\)\);/);
  });
});

// F022: Firefox's sidebar opens 216px wide; body's min-width of 320px cut
// off the nav, Lock, Remove and most of Approve. e2e/tests/narrow-sidebar
// checks the layout in a browser; this keeps its CSS from slipping back.
describe('narrow sidebar (F022)', () => {
  const css = read('App.css');

  it('lets the side panel be narrower than 320px', () => {
    expect(rule(css, 'body')).toMatch(/min-width: 0;/);
    // The toolbar popup keeps its fixed width.
    expect(rule(css, 'html.popup body')).toMatch(/min-width: 360px/);
  });

  it('tightens the layout below 300px, after the rules it overrides', () => {
    const at = css.indexOf('@media (max-width: 299px)');
    expect(at).toBeGreaterThan(css.lastIndexOf('\n.approval-actions {'));
    expect(at).toBeGreaterThan(css.lastIndexOf('\n.header {'));
    const block = css.slice(at);
    expect(block).toMatch(/\.approval-actions \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(block).toMatch(/\.header \{\s*flex-wrap: wrap;/);
  });
});
