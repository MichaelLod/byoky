import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

  it('drops the fixed size when popup.html is opened as a window', () => {
    expect(read('main.tsx')).toMatch(/has\('window'\)[\s\S]*classList\.remove\('popup'\)/);
  });
});
