/**
 * Building blocks for the store images in the 1.1.1 "retro security" design
 * (docs/brand/README.md): void ground, dot grid, scanlines, violet accents,
 * Chakra Petch headlines, IBM Plex text and Muninn the raven.
 *
 * Each image is an HTML page rendered by Chromium at its exact pixel size, so
 * the brand fonts and CSS do the typesetting. A tiny static server rooted at
 * the repo serves the pages, the bundled fonts (marketing/fonts) and the raw
 * captures. Output PNGs are flattened to RGB: the App Store and Google Play
 * reject screenshots with an alpha channel.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import sharp from 'sharp';

export const ROOT = path.resolve(__dirname, '../..');
export const MARKETING = path.join(ROOT, 'marketing');
const CACHE = path.join(MARKETING, '.cache/compose');

// The repo root's Playwright has its browser installed (the e2e suite uses it);
// marketing/'s own copy may be a version whose browser isn't downloaded.
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('@playwright/test') as typeof import('@playwright/test');

export const C = {
  void: '#07060A',
  crypt: '#100D16',
  ash: '#17121F',
  ink: '#0B0910',
  seam: '#2A2236',
  seamStrong: '#3B2D55',
  bone: '#ECE8F4',
  fog: '#A79FB8',
  dim: '#857C95',
  violet: '#7C3AED',
  phosphor: '#A78BFA',
  lilac: '#C4B5FD',
  signal: '#4ADE80',
};

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Headline markup: `*word*` is set in phosphor, `\n` breaks the line. */
export function headline(s: string): string {
  return esc(s)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/** Repo-absolute path → URL on the kit's server. */
export function asset(abs: string): string {
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..')) throw new Error(`asset outside the repo: ${abs}`);
  return '/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

// ── Brand art ────────────────────────────────────────────────────────────

const RAVEN_SRC = fs.readFileSync(path.join(ROOT, 'docs/brand/raven.svg'), 'utf8');
const RAVEN_BODY = RAVEN_SRC.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
export const APP_ICON = asset(path.join(ROOT, 'docs/brand/app-icon-rounded.svg'));

export type RavenPose = 'watching' | 'alert' | 'asleep';

/**
 * Muninn from docs/brand/raven.svg, posed as the README describes.
 * `look` tilts the head (degrees, + = down) and nudges the pupil.
 */
export function muninn(opts: { size: number; pose?: RavenPose; faceLeft?: boolean; look?: number; id?: string }): string {
  const pose = opts.pose ?? 'watching';
  const id = opts.id ?? `m${Math.random().toString(36).slice(2, 8)}`;
  const look = opts.look ?? 4;
  const css: string[] = [];
  const sel = (part: string) => `#${id} #${part}`;
  css.push(`#${id} #raven, #${id} #head, #${id} #pupil { transform-box: view-box; }`);
  css.push(`${sel('head')} { transform-origin: 140px 96px; }`);
  if (opts.faceLeft) css.push(`${sel('raven')} { transform-origin: 120px 0; transform: scaleX(-1); }`);
  if (pose === 'watching') {
    css.push(`${sel('head')} { transform: rotate(${look}deg); }`);
    css.push(`${sel('pupil')} { transform: translate(1.6px, ${Math.max(-2.4, Math.min(2.4, look / 4))}px); }`);
  } else if (pose === 'alert') {
    css.push(`${sel('head')} { transform: rotate(-8deg); }`);
    css.push(`${sel('crest')}, ${sel('eye-glow')} { display: inline; }`);
    css.push(`${sel('pupil')} { transform: translate(2.2px, 0); }`);
  } else {
    css.push(`${sel('head')} { transform: translate(-6px, 26px) rotate(34deg); }`);
    css.push(`${sel('eye')}, ${sel('pupil')} { display: none; } ${sel('eye-closed')} { display: inline; }`);
  }
  const zz =
    pose === 'asleep'
      ? `<text x="196" y="96" font-family="IBM Plex Mono" font-size="15" fill="${C.phosphor}">z</text><text x="210" y="80" font-family="IBM Plex Mono" font-size="11" fill="${C.phosphor}">z</text>`
      : '';
  return `<svg id="${id}" class="muninn" viewBox="0 0 240 240" width="${opts.size}" height="${opts.size}" aria-hidden="true"><style>${css.join('\n')}</style>${RAVEN_BODY}${zz}</svg>`;
}

// ── Page scaffolding ─────────────────────────────────────────────────────

const FONTS = path.join(MARKETING, 'fonts');
function face(family: string, weight: number, file: string): string {
  return `@font-face { font-family: "${family}"; font-weight: ${weight}; font-style: normal; src: url("${asset(path.join(FONTS, file))}") format("woff2"); }`;
}
const FONT_FACES = [
  face('Chakra Petch', 600, 'chakra-petch-latin-600-normal.woff2'),
  face('Chakra Petch', 700, 'chakra-petch-latin-700-normal.woff2'),
  face('IBM Plex Sans', 400, 'ibm-plex-sans-latin-400-normal.woff2'),
  face('IBM Plex Sans', 500, 'ibm-plex-sans-latin-500-normal.woff2'),
  face('IBM Plex Sans', 600, 'ibm-plex-sans-latin-600-normal.woff2'),
  face('IBM Plex Mono', 400, 'ibm-plex-mono-latin-400-normal.woff2'),
  face('IBM Plex Mono', 500, 'ibm-plex-mono-latin-500-normal.woff2'),
].join('\n');

/**
 * Base CSS for a W×H canvas. `u` is the size of one design unit in pixels, so
 * the same layout scales from a 440×280 tile to a 2880×1800 Mac screenshot.
 */
export function baseCss(w: number, h: number, u: number): string {
  const px = (n: number) => `${+(n * u).toFixed(2)}px`;
  return `
${FONT_FACES}
:root { --u: ${u}px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${C.void}; }
body { position: relative; color: ${C.bone}; font-family: "IBM Plex Sans", sans-serif; -webkit-font-smoothing: antialiased; }
.layer { position: absolute; inset: 0; pointer-events: none; }
.dots { background-image: radial-gradient(circle at ${px(1)} ${px(1)}, rgba(167,139,250,0.10) ${px(1)}, transparent 0); background-size: ${px(26)} ${px(26)}; }
.scan { background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) ${px(1)}, transparent ${px(1)}, transparent ${px(3)}); }
.status { font-family: "IBM Plex Mono", monospace; font-weight: 500; text-transform: uppercase; letter-spacing: 0.16em; color: ${C.phosphor}; white-space: nowrap; }
.status .cur { display: inline-block; width: 0.6em; height: 0.95em; margin-left: 0.18em; vertical-align: -0.12em; background: ${C.phosphor}; }
h1 { text-wrap: balance; font-family: "Chakra Petch", sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.02em; line-height: 1.04; color: ${C.bone}; }
h1 em { font-style: normal; color: ${C.phosphor}; }
.sub { color: ${C.fog}; line-height: 1.45; text-wrap: balance; }
.lockup { display: flex; align-items: center; gap: ${px(10)}; font-family: "Chakra Petch", sans-serif; font-weight: 700; letter-spacing: 0.08em; color: ${C.bone}; }
.lockup img { display: block; }
.brackets { position: absolute; pointer-events: none; }
.brackets i { position: absolute; width: ${px(18)}; height: ${px(18)}; border: 0 solid ${C.violet}; }
.brackets i:nth-child(1) { left: 0; top: 0; border-left-width: ${px(2)}; border-top-width: ${px(2)}; }
.brackets i:nth-child(2) { right: 0; top: 0; border-right-width: ${px(2)}; border-top-width: ${px(2)}; }
.brackets i:nth-child(3) { left: 0; bottom: 0; border-left-width: ${px(2)}; border-bottom-width: ${px(2)}; }
.brackets i:nth-child(4) { right: 0; bottom: 0; border-right-width: ${px(2)}; border-bottom-width: ${px(2)}; }
`;
}

/** Violet glow centred at (x, y) with radius r, all in pixels. */
export function glow(x: number, y: number, r: number, strength = 0.26): string {
  return `<div class="layer" style="background: radial-gradient(circle ${Math.round(r)}px at ${Math.round(x)}px ${Math.round(y)}px, rgba(124,58,237,${strength}), rgba(124,58,237,0) 100%);"></div>`;
}

/** Corner brackets around a box (pixels), `gap` outside it. */
export function brackets(box: { x: number; y: number; w: number; h: number }, gap: number): string {
  return `<div class="brackets" style="left:${box.x - gap}px; top:${box.y - gap}px; width:${box.w + 2 * gap}px; height:${box.h + 2 * gap}px;"><i></i><i></i><i></i><i></i></div>`;
}

export function statusLine(text: string): string {
  return `<div class="status">&gt; ${esc(text)}<span class="cur"></span></div>`;
}

export function page(w: number, h: number, u: number, css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(w, h, u)}\n${css}</style></head><body>${body}</body></html>`;
}

// ── Rendering ────────────────────────────────────────────────────────────

export interface Rendered {
  file: string;
  width: number;
  height: number;
}

export class Kit {
  private server!: http.Server;
  private base = '';
  private browser!: import('@playwright/test').Browser;
  readonly written: Rendered[] = [];

  static async open(): Promise<Kit> {
    const kit = new Kit();
    fs.mkdirSync(CACHE, { recursive: true });
    const types: Record<string, string> = { '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
    kit.server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] ?? 'application/octet-stream' });
      res.end(fs.readFileSync(p));
    });
    await new Promise<void>((r) => kit.server.listen(0, '127.0.0.1', () => r()));
    const addr = kit.server.address();
    kit.base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    kit.browser = await chromium.launch();
    return kit;
  }

  /** Render `html` at exactly w×h and write an RGB PNG to `out`. */
  async render(out: string, w: number, h: number, html: string): Promise<Rendered> {
    const name = path.basename(out, '.png');
    const htmlFile = path.join(CACHE, `${path.basename(path.dirname(out))}-${name}.html`);
    fs.writeFileSync(htmlFile, html);
    const ctx = await this.browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    const missing: string[] = [];
    pg.on('response', (r) => { if (r.status() >= 400) missing.push(r.url()); });
    await pg.goto(this.base + asset(htmlFile), { waitUntil: 'networkidle' });
    await pg.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    });
    if (missing.length) throw new Error(`${name}: missing ${missing.join(', ')}`);
    const shot = await pg.screenshot({ type: 'png' });
    await ctx.close();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(shot).flatten({ background: C.void }).removeAlpha().png({ compressionLevel: 9 }).toFile(out);
    const meta = await sharp(out).metadata();
    if (meta.width !== w || meta.height !== h || meta.channels !== 3) {
      throw new Error(`${out}: got ${meta.width}×${meta.height}×${meta.channels}, expected ${w}×${h} RGB`);
    }
    const rendered = { file: out, width: w, height: h };
    this.written.push(rendered);
    console.log(`  ${path.relative(ROOT, out)}  ${w}×${h}`);
    return rendered;
  }

  /** One overview image of a store's set, for review. */
  async contactSheet(out: string, title: string, items: Rendered[]): Promise<void> {
    const W = 2400;
    const cols = items.length > 4 && items[0].height > items[0].width ? Math.min(items.length, 6) : Math.min(items.length, 3);
    const gap = 36;
    const cellW = Math.floor((W - 2 * 64 - (cols - 1) * gap) / cols);
    const rows: Rendered[][] = [];
    for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
    const cellH = (it: Rendered) => Math.round((cellW * it.height) / it.width);
    const rowH = rows.map((r) => Math.max(...r.map(cellH)) + 56);
    const H = 64 + 90 + rowH.reduce((a, b) => a + b + gap, 0) + 24;
    const cells = rows
      .map((r, ri) => {
        const top = 64 + 90 + rowH.slice(0, ri).reduce((a, b) => a + b + gap, 0);
        return r
          .map((it, ci) => {
            const left = 64 + ci * (cellW + gap);
            return `<figure style="position:absolute; left:${left}px; top:${top}px; width:${cellW}px;">
              <img src="${asset(it.file)}" style="display:block; width:${cellW}px; height:${cellH(it)}px; outline:1px solid ${C.seam};">
              <figcaption>${esc(path.basename(it.file))} <span>${it.width}×${it.height}</span></figcaption></figure>`;
          })
          .join('');
      })
      .join('');
    const css = `figcaption { margin-top: 12px; font: 500 17px "IBM Plex Mono", monospace; color: ${C.fog}; letter-spacing: 0.04em; }
      figcaption span { color: ${C.dim}; margin-left: 8px; }
      .t { position:absolute; left:64px; top:56px; }`;
    const html = page(W, H, 1, css, `<div class="layer dots"></div>
      <div class="t"><div class="status" style="font-size:16px">Byoky 1.1.1 · store images</div>
      <h1 style="font-size:40px; margin-top:10px">${esc(title)}</h1></div>${cells}`);
    const prev = this.written.length;
    await this.render(out, W, H, html);
    this.written.length = prev; // sheets aren't store assets
  }

  async close(): Promise<void> {
    await this.browser.close();
    this.server.close();
  }
}
