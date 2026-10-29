/**
 * Store images for Byoky 1.1.1 in the "retro security" design.
 *
 * Inputs (fake data only; see each capture script's header):
 *   raw/store-extension/  capture-extension-store.mjs   popup, 360×600 @3x
 *   raw/store-ios/        store-capture/ios/run.sh      iPhone 6.9" + iPad 13"
 *   raw/store-android/    store-capture/android/        Pixel-class phone
 *   raw/store-mac/        store-capture/mac/run.sh      Mac app window page
 *   raw/store-web/        capture-web-store.mjs         byoky.com/demo connect screen
 *
 * Output: composites/1.1.1/<store>/NN-<slug>-WxH.png in upload order:
 *   chrome/   5 screenshots 1280×800, promo tile 440×280, marquee 1400×560
 *   firefox/  the same 5 screenshots
 *   ios/      6 iPhone 1320×2868 (6.9") + 5 iPad 2064×2752 (13")
 *   mac/      5 screenshots 2880×1800
 *   play/     6 phone 1080×1920, feature graphic 1024×500, icon 512×512
 *             (the last two from android-store-assets.ts)
 *   producthunt/  7 gallery images 1270×760, thumbnail 240×240 (icon-512.png
 *             downscaled); listing text in producthunt/listing.md
 * plus one contact sheet per store in composites/1.1.1-contact/ (or the
 * directory given with --contact <dir>).
 *
 * Store rules (docs/store-listing.md): no other brand in headlines or outside
 * the app UI, nothing from retired features, short true headlines, "Byoky".
 *
 *   cd marketing && pnpm compose [-- --only chrome,ios] [-- --contact <dir>]
 *
 * The pre-1.1.1 composer (old look, old Product Hunt images) is compose-legacy.ts.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { buildPlayAssets } from './android-store-assets';
import {
  APP_ICON, C, Kit, MARKETING, ROOT, Rendered, asset, brackets, esc, glow, headline, muninn, page, statusLine,
} from './store-kit';

const RAW = path.join(MARKETING, 'raw');
const OUT = path.join(MARKETING, 'composites/1.1.1');
const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const ONLY = argValue('--only')?.split(',');
const CONTACT = path.resolve(argValue('--contact') ?? path.join(MARKETING, 'composites/1.1.1-contact'));

function raw(dir: string, name: string): string {
  const p = path.join(RAW, dir, name);
  if (!fs.existsSync(p)) throw new Error(`missing capture ${path.relative(ROOT, p)}; run its capture script first`);
  return p;
}

interface Copy {
  status: string;
  title: string;
  sub: string;
}

// ── Landscape: Chrome Web Store, Firefox Add-ons, Mac App Store ──────────

function landscapeText(copy: Copy, o: { left: number; width: number; u: number; h: number; type?: number }): string {
  const { u } = o;
  const k = o.type ?? 1; // type scale on top of u
  return `
  <div style="position:absolute; left:${o.left}px; top:0; height:${o.h}px; width:${o.width}px; display:flex; flex-direction:column; justify-content:center;">
    <div style="font-size:${15 * u * k}px">${statusLine(copy.status)}</div>
    <h1 style="font-size:${60 * u * k}px; margin-top:${18 * u * k}px">${headline(copy.title)}</h1>
    <p class="sub" style="font-size:${21 * u * k}px; margin-top:${22 * u * k}px; max-width:${450 * u * k}px">${esc(copy.sub)}</p>
  </div>
  <div class="lockup" style="position:absolute; left:${o.left}px; bottom:${52 * u}px; font-size:${19 * u}px">
    <img src="${APP_ICON}" style="width:${32 * u}px; height:${32 * u}px">BYOKY
  </div>`;
}

/**
 * The popup floating on the right, framed like the featured panel. Laid out
 * for 1280×800; a shorter canvas (Product Hunt's 1270×760) scales the popup
 * down to fit and keeps the same margins, so nothing is cropped.
 */
function chromeSlide(shot: string, copy: Copy, W = 1280, H = 800): string {
  const u = 1;
  const ph = Math.min(660, H - 130); // 360×600 CSS px at 1.1, or less when the canvas is shorter
  const pw = Math.round((ph * 360) / 600);
  const px = W - 94 - pw, py = Math.round((H - ph) / 2);
  const css = `.popup { position:absolute; left:${px}px; top:${py}px; width:${pw}px; height:${ph}px; border:1px solid ${C.seamStrong};
      box-shadow: 0 0 0 1px rgba(124,58,237,0.28), 0 30px 90px rgba(124,58,237,0.22); }
    .popup img { display:block; width:100%; height:100%; }`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(px + pw / 2, H / 2, 560, 0.24)}
    <div class="layer scan"></div>
    ${landscapeText(copy, { left: 92, width: 600, u, h: H })}
    <div class="popup"><img src="${asset(shot)}"></div>
    ${brackets({ x: px, y: py, w: pw, h: ph }, 16)}`);
}

/** A browser window on a Mac with the Byoky popup open over byoky.com/demo. */
function macBrowserSlide(shot: string, copy: Copy, demo: string): string {
  const W = 2880, H = 1800, u = 2.25;
  const win = { x: 1190, y: 168, w: 1580, h: 1464 };
  const bar = 104;
  const pw = 720, ph = 1200; // the popup's real size on a 2x display
  const px = win.x + win.w - pw - 34, py = win.y + bar + 14;
  const iconX = px + pw - 70; // extension button, above the popup's right side
  const visCenter = (win.x + px) / 2; // middle of the page area left of the popup
  const demoW = 1960;
  const css = `
    .win { position:absolute; left:${win.x}px; top:${win.y}px; width:${win.w}px; height:${win.h}px; background:${C.void};
      border:2px solid ${C.seamStrong}; border-radius:22px; overflow:hidden; box-shadow: 0 50px 160px rgba(0,0,0,0.6), 0 0 0 2px rgba(124,58,237,0.16); }
    .bar { position:absolute; left:0; top:0; right:0; height:${bar}px; background:${C.crypt}; border-bottom:2px solid ${C.seam}; }
    .lights { position:absolute; left:34px; top:${bar / 2 - 12}px; display:flex; gap:18px; }
    .lights i { width:24px; height:24px; border-radius:50%; background:${C.seamStrong}; }
    .nav { position:absolute; left:190px; top:${bar / 2 - 18}px; font: 500 34px "IBM Plex Mono", monospace; color:${C.dim}; letter-spacing:0.3em; }
    .addr { position:absolute; left:${(win.w - 760) / 2}px; top:${bar / 2 - 30}px; width:760px; height:60px; background:${C.void}; border:2px solid ${C.seam};
      display:flex; align-items:center; justify-content:center; gap:14px; font: 400 27px "IBM Plex Mono", monospace; color:${C.fog}; }
    .addr svg { width:22px; height:26px; }
    .ext { position:absolute; left:${iconX - win.x - 34}px; top:${bar / 2 - 34}px; width:68px; height:68px; background:rgba(124,58,237,0.18);
      border:2px solid ${C.violet}; display:flex; align-items:center; justify-content:center; }
    .ext img { width:46px; height:46px; }
    .pagebg { position:absolute; left:0; top:${bar}px; right:0; bottom:0; overflow:hidden; }
    .pagebg img { position:absolute; left:${Math.round(visCenter - win.x - demoW / 2)}px; top:40px; width:${demoW}px; height:auto; opacity:0.9;
      -webkit-mask-image: linear-gradient(to bottom, #000 78%, transparent); }
    .popup { position:absolute; left:${px}px; top:${py}px; width:${pw}px; height:${ph}px; border:2px solid ${C.seamStrong};
      box-shadow: 0 0 0 2px rgba(124,58,237,0.3), 0 40px 120px rgba(0,0,0,0.65); }
    .popup img { display:block; width:100%; height:100%; }`;
  const lock = `<svg viewBox="0 0 22 26"><rect x="2" y="11" width="18" height="14" fill="${C.dim}"/><path d="M6 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="${C.dim}" stroke-width="3"/></svg>`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(win.x + win.w / 2, H / 2, 1300, 0.2)}
    <div class="layer scan"></div>
    ${landscapeText(copy, { left: 170, width: 1000, u, h: H, type: 0.8 })}
    <div class="win">
      <div class="pagebg"><img src="${asset(demo)}"></div>
      <div class="bar"><div class="lights"><i></i><i></i><i></i></div><div class="nav">&lt; &gt;</div>
        <div class="addr">${lock}byoky.com/demo</div>
        <div class="ext"><img src="${APP_ICON}"></div></div>
    </div>
    <div class="popup"><img src="${asset(shot)}"></div>
    ${brackets({ x: px, y: py, w: pw, h: ph }, 30)}`);
}

/** The Mac app's own window: Muninn and the extension switch. */
function macAppSlide(shot: string, copy: Copy): string {
  const W = 2880, H = 1800, u = 2.25;
  const cw = 1360, ch = 1040; // 425×325 pt window content at 3.2x
  const tb = 84;
  const wx = 1300, wy = Math.round((H - ch - tb) / 2);
  const css = `
    .mwin { position:absolute; left:${wx}px; top:${wy}px; width:${cw}px; height:${ch + tb}px; border:2px solid ${C.seamStrong}; border-radius:26px; overflow:hidden;
      background:${C.void}; box-shadow: 0 0 0 2px rgba(124,58,237,0.22), 0 50px 160px rgba(124,58,237,0.2); }
    .tb { position:relative; height:${tb}px; background:${C.crypt}; border-bottom:2px solid ${C.seam}; display:flex; align-items:center; justify-content:center;
      font: 600 30px "IBM Plex Sans", sans-serif; color:${C.fog}; }
    .tb .lights { position:absolute; left:30px; top:${tb / 2 - 12}px; display:flex; gap:18px; }
    .tb .lights i { width:24px; height:24px; border-radius:50%; background:${C.seamStrong}; }
    .mwin > img { display:block; width:${cw}px; height:${ch}px; }`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(wx + cw / 2, H / 2, 1100, 0.24)}
    <div class="layer scan"></div>
    ${landscapeText(copy, { left: 170, width: 1060, u, h: H, type: 0.8 })}
    <div class="mwin"><div class="tb"><div class="lights"><i></i><i></i><i></i></div>Byoky</div><img src="${asset(shot)}"></div>
    ${brackets({ x: wx, y: wy, w: cw, h: ch + tb }, 30)}`);
}

// ── Portrait: App Store (iPhone, iPad), Google Play ──────────────────────

type Device = 'iphone' | 'ipad' | 'android';

function portraitSlide(shot: string, copy: Copy, device: Device, W: number, H: number, srcW: number, srcH: number): string {
  // Layout in points; u converts to pixels.
  const layoutW = device === 'ipad' ? 640 : 440;
  const u = W / layoutW;
  const t = device === 'android'
    ? { top: 46, status: 11, h1: 31, sub: 14, gap: 12, after: 26, bottom: 34, bezel: 5 }
    : device === 'ipad'
      ? { top: 54, status: 12, h1: 38, sub: 17, gap: 14, after: 34, bottom: 40, bezel: 9 }
      : { top: 60, status: 12, h1: 36, sub: 16, gap: 14, after: 30, bottom: 40, bezel: 6 };
  const headH = t.top + t.status * 1.4 + t.gap + t.h1 * 1.04 * 2 + t.gap + t.sub * 1.45 * 2 + t.after;
  const frameH = H - (headH + t.bottom) * u;
  const bezel = t.bezel * u;
  const imgH = frameH - 2 * bezel;
  const imgW = (imgH * srcW) / srcH;
  const frameW = imgW + 2 * bezel;
  const fx = (W - frameW) / 2;
  const fy = headH * u;
  const screenR = device === 'iphone' ? imgW * 0.135 : device === 'android' ? imgW * 0.085 : imgW * 0.035;
  const camera =
    device === 'iphone'
      ? `<div style="position:absolute; left:${bezel + imgW * 0.3575}px; top:${bezel + imgW * 0.026}px; width:${imgW * 0.285}px; height:${imgW * 0.084}px; border-radius:${imgW}px; background:#000;"></div>`
      : device === 'android'
        ? `<div style="position:absolute; left:${bezel + imgW / 2 - imgW * 0.016}px; top:${bezel + imgW * 0.022}px; width:${imgW * 0.032}px; height:${imgW * 0.032}px; border-radius:50%; background:#000;"></div>`
        : '';
  const css = `
    .head { position:absolute; left:0; right:0; top:${t.top * u}px; text-align:center; display:flex; flex-direction:column; align-items:center; }
    .frame { position:absolute; left:${fx}px; top:${fy}px; width:${frameW}px; height:${frameH}px; padding:${bezel}px; background:${C.ink};
      border:${Math.max(2, u)}px solid ${C.seamStrong}; border-radius:${screenR + bezel}px;
      box-shadow: 0 0 0 ${u}px rgba(124,58,237,0.22), 0 ${30 * u}px ${110 * u}px rgba(124,58,237,0.2); }
    .frame > img { display:block; width:${imgW}px; height:${imgH}px; border-radius:${screenR}px; }`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(W / 2, fy + frameH * 0.45, Math.max(W, frameH) * 0.62, 0.24)}
    <div class="layer scan"></div>
    <div class="head">
      <div style="font-size:${t.status * u}px">${statusLine(copy.status)}</div>
      <h1 style="font-size:${t.h1 * u}px; margin-top:${t.gap * u}px">${headline(copy.title)}</h1>
      <p class="sub" style="font-size:${t.sub * u}px; margin-top:${t.gap * u}px; max-width:${(layoutW - 70) * u}px">${esc(copy.sub)}</p>
    </div>
    <div class="frame"><img src="${asset(shot)}">${camera}</div>
    ${brackets({ x: fx, y: fy, w: frameW, h: frameH }, 14 * u)}`);
}

// ── Chrome promo tiles ───────────────────────────────────────────────────

function promoSmall(): string {
  const W = 440, H = 280, u = 1;
  return page(W, H, u, '', `
    <div class="layer dots"></div>
    ${glow(120, 150, 230, 0.32)}
    <div class="layer scan"></div>
    <div style="position:absolute; left:6px; top:36px">${muninn({ size: 210, look: 6 })}</div>
    <div style="position:absolute; left:214px; top:0; bottom:0; display:flex; flex-direction:column; justify-content:center;">
      <div class="lockup" style="font-size:40px; letter-spacing:0.08em">BYOKY</div>
      <p class="sub" style="font-size:16px; line-height:1.35; margin-top:8px; color:${C.bone}">Wallet for your<br>AI API keys</p>
      <div style="font-size:10.5px; margin-top:16px">${statusLine('Keys stay local')}</div>
    </div>
    ${brackets({ x: 14, y: 14, w: W - 28, h: H - 28 }, 0)}`);
}

function promoMarquee(popup: string): string {
  const W = 1400, H = 560, u = 1;
  const pw = 300, ph = 500, px = W - pw - 70, py = 30;
  const css = `.popup { position:absolute; left:${px}px; top:${py}px; width:${pw}px; height:${ph}px; border:1px solid ${C.seamStrong};
      box-shadow: 0 0 0 1px rgba(124,58,237,0.28), 0 30px 90px rgba(124,58,237,0.25); }
    .popup img { display:block; width:100%; height:100%; }`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(1000, 300, 520, 0.28)}
    <div class="layer scan"></div>
    <div style="position:absolute; left:84px; top:0; bottom:0; width:640px; display:flex; flex-direction:column; justify-content:center;">
      <div style="font-size:15px">${statusLine('Wallet unlocked')}</div>
      <h1 style="font-size:62px; margin-top:16px">${headline('One wallet for\nyour *AI keys*')}</h1>
      <p class="sub" style="font-size:21px; margin-top:18px; max-width:600px">Apps connect to the wallet. Your keys stay encrypted on your device.</p>
      <div class="lockup" style="font-size:19px; margin-top:34px"><img src="${APP_ICON}" style="width:32px; height:32px">BYOKY</div>
    </div>
    <div style="position:absolute; left:${px - 370}px; top:${H - 345}px">${muninn({ size: 330, look: -4 })}</div>
    <div class="popup"><img src="${asset(popup)}"></div>
    ${brackets({ x: px, y: py, w: pw, h: ph }, 12)}`);
}

// ── Product Hunt gallery (1270×760) ──────────────────────────────────────
// The Chrome slides re-laid out at 1270×760 (chromeSlide scales the popup),
// plus a cover with Muninn, a phones slide and a developer slide. Same rules
// as the stores: only today's features, no brand other than provider names
// as compatibility facts.

const PH_W = 1270, PH_H = 760;

/** First gallery image: the pitch, Muninn and the wallet. */
function phCover(popup: string): string {
  const W = PH_W, H = PH_H, u = 1;
  const ph = 630, pw = 378, px = W - 94 - pw, py = Math.round((H - ph) / 2);
  const css = `.popup { position:absolute; left:${px}px; top:${py}px; width:${pw}px; height:${ph}px; border:1px solid ${C.seamStrong};
      box-shadow: 0 0 0 1px rgba(124,58,237,0.28), 0 30px 90px rgba(124,58,237,0.25); }
    .popup img { display:block; width:100%; height:100%; }
    .facts { font: 500 13px "IBM Plex Mono", monospace; letter-spacing:0.14em; text-transform:uppercase; color:${C.fog}; white-space:nowrap; }
    .facts b { font-weight:500; color:${C.phosphor}; }`;
  const facts = ['13 providers', 'No servers', 'AES-256-GCM', 'MIT'].map((f) => esc(f)).join(' <b>·</b> ');
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(px + pw / 2, H / 2, 560, 0.26)}
    ${glow(470, 600, 300, 0.2)}
    <div class="layer scan"></div>
    <div style="position:absolute; left:92px; top:96px; width:620px;">
      <div style="font-size:15px">${statusLine('Wallet unlocked')}</div>
      <h1 style="font-size:64px; margin-top:18px">${headline('One wallet for\nyour *AI keys*')}</h1>
      <p class="sub" style="font-size:21px; margin-top:22px; max-width:470px">Apps connect to the wallet. Your keys stay encrypted on your device.</p>
      <div class="facts" style="margin-top:26px">${facts}</div>
    </div>
    <div style="position:absolute; left:318px; top:396px">${muninn({ size: 350, look: 5 })}</div>
    <div class="lockup" style="position:absolute; left:92px; bottom:52px; font-size:19px">
      <img src="${APP_ICON}" style="width:32px; height:32px">BYOKY
    </div>
    <div class="popup"><img src="${asset(popup)}"></div>
    ${brackets({ x: px, y: py, w: pw, h: ph }, 16)}`);
}

/** A phone screenshot in a plain bezel, `imgH` pixels tall. */
function phoneFrame(shot: string, device: 'iphone' | 'android', x: number, y: number, imgH: number, srcW: number, srcH: number): string {
  const bezel = 6;
  const imgW = (imgH * srcW) / srcH;
  const r = device === 'iphone' ? imgW * 0.135 : imgW * 0.085;
  const camera =
    device === 'iphone'
      ? `<div style="position:absolute; left:${bezel + imgW * 0.3575}px; top:${bezel + imgW * 0.026}px; width:${imgW * 0.285}px; height:${imgW * 0.084}px; border-radius:${imgW}px; background:#000;"></div>`
      : `<div style="position:absolute; left:${bezel + imgW / 2 - imgW * 0.016}px; top:${bezel + imgW * 0.022}px; width:${imgW * 0.032}px; height:${imgW * 0.032}px; border-radius:50%; background:#000;"></div>`;
  return `<div style="position:absolute; left:${x}px; top:${y}px; width:${imgW + 2 * bezel}px; height:${imgH + 2 * bezel}px; padding:${bezel}px; background:${C.ink};
      border:2px solid ${C.seamStrong}; border-radius:${r + bezel}px; box-shadow: 0 0 0 1px rgba(124,58,237,0.22), 0 30px 90px rgba(124,58,237,0.2);">
      <img src="${asset(shot)}" style="display:block; width:${imgW}px; height:${imgH}px; border-radius:${r}px;">${camera}</div>`;
}

/** iPhone and Android side by side. */
function phPhones(iphone: string, android: string, copy: Copy): string {
  const W = PH_W, H = PH_H, u = 1;
  const frameH = 600, imgH = frameH - 12;
  const iW = (imgH * 1320) / 2868 + 12, aW = (imgH * 1080) / 2424 + 12;
  const gap = 28;
  const right = W - 94;
  const ax = right - aW, ix = ax - gap - iW;
  const fy = Math.round((H - frameH) / 2);
  return page(W, H, u, '', `
    <div class="layer dots"></div>
    ${glow((ix + right) / 2, H / 2, 560, 0.24)}
    <div class="layer scan"></div>
    ${landscapeText(copy, { left: 92, width: 470, u, h: H })}
    ${phoneFrame(iphone, 'iphone', ix, fy, imgH, 1320, 2868)}
    ${phoneFrame(android, 'android', ax, fy, imgH, 1080, 2424)}
    ${brackets({ x: ix, y: fy, w: right - ix, h: frameH }, 16)}`);
}

/** The SDK in an app, as on byoky.com (packages/web/app/page.tsx, CodeBlock). */
function phDevelopers(copy: Copy): string {
  const W = PH_W, H = PH_H, u = 1;
  const k = (s: string) => `<span style="color:${C.phosphor}">${s}</span>`; // keyword
  const t = (s: string) => `<span style="color:${C.bone}; font-weight:500">${s}</span>`; // type
  const s = (v: string) => `<span style="color:${C.signal}">${esc(v)}</span>`; // string
  const c = (v: string) => `<span style="color:${C.dim}">${esc(v)}</span>`; // comment
  const p = (v: string) => `<span style="color:${C.lilac}">${v}</span>`; // property
  const lines = [
    `${k('import')} ${t('Anthropic')} ${k('from')} ${s("'@anthropic-ai/sdk'")};`,
    `${k('import')} { ${t('Byoky')} } ${k('from')} ${s("'@byoky/sdk'")};`,
    '',
    `${k('const')} ${p('session')} = ${k('await new')} ${t('Byoky')}().${p('connect')}({`,
    `  ${p('providers')}: [{ ${p('id')}: ${s("'anthropic'")}, ${p('required')}: ${k('true')} }],`,
    `  ${p('modal')}: ${k('true')},`,
    '});',
    '',
    c('// The official SDK. The key stays in the wallet.'),
    `${k('const')} ${p('client')} = ${k('new')} ${t('Anthropic')}({`,
    `  ${p('apiKey')}: ${p('session')}.${p('sessionKey')},`,
    `  ${p('fetch')}: ${p('session')}.${p('createFetch')}(${s("'anthropic'")}),`,
    '});',
  ];
  const cw = 540, ch = 412; // title bar + 13 lines
  const cx = W - 94 - cw, cy = Math.round((H - ch - 67) / 2); // centre the window plus the two log lines under it
  const css = `
    .code { position:absolute; left:${cx}px; top:${cy}px; width:${cw}px; height:${ch}px; background:${C.ink}; border:1px solid ${C.seamStrong};
      box-shadow: 0 0 0 1px rgba(124,58,237,0.24), 0 30px 90px rgba(124,58,237,0.22); }
    .code .bar { height:40px; display:flex; align-items:center; justify-content:space-between; padding:0 18px; background:${C.crypt}; border-bottom:1px solid ${C.seam};
      font: 500 12px "IBM Plex Mono", monospace; letter-spacing:0.14em; text-transform:uppercase; color:${C.dim}; }
    .code .bar b { font-weight:500; color:${C.fog}; }
    .code pre { margin:0; padding:22px 24px; font: 400 14.5px/1.72 "IBM Plex Mono", monospace; color:${C.fog}; white-space:pre; }
    .term { position:absolute; left:${cx}px; top:${cy + ch + 22}px; width:${cw}px; font: 500 13px "IBM Plex Mono", monospace; letter-spacing:0.04em; color:${C.fog}; }
    .term div + div { margin-top:8px; }
    .term .pr { color:${C.phosphor}; } .term .ok { color:${C.signal}; }`;
  return page(W, H, u, css, `
    <div class="layer dots"></div>
    ${glow(cx + cw / 2, H / 2, 560, 0.22)}
    <div class="layer scan"></div>
    ${landscapeText(copy, { left: 92, width: 500, u, h: H })}
    <div class="code"><div class="bar"><b>app.ts</b><span>@byoky/sdk</span></div><pre>${lines.join('\n')}</pre></div>
    <div class="term">
      <div><span class="pr">&gt;</span> localhost:3000 wants to connect · <span class="ok">approved</span></div>
      <div><span class="pr">&gt;</span> POST /v1/messages <span class="ok">200</span> · streaming</div>
    </div>
    ${brackets({ x: cx, y: cy, w: cw, h: ch }, 16)}`);
}

// ── Copy ─────────────────────────────────────────────────────────────────

const COPY = {
  wallet: (where: string): Copy => ({ status: 'Wallet unlocked', title: 'One wallet for\nyour *AI keys*', sub: `Keys stay encrypted on ${where}. Apps connect to the wallet and never see them.` }),
  approve: { status: 'Incoming connection', title: 'Approve every\n*connection*', sub: 'Every site asks first. Approve it once, or trust it for good.' },
  limits: { status: 'Token limit', title: 'Set *limits*\nper app', sub: 'Cap the tokens each app can use, in total or per provider.' },
  route: { status: 'Routing', title: 'Route between\n*providers*', sub: 'Move an app to another group. Its requests use that group’s key, translated on the fly.' },
  locked: { status: 'Wallet locked', title: 'Locked tight,\n*AES-256-GCM*', sub: 'No account, no cloud. Keys are encrypted on this device with your password.' },
  connected: { status: '2 apps connected', title: 'Apps connect.\n*Keys stay.*', sub: 'Web apps run in the built-in browser and use your wallet, never your keys.' },
  reconnect: { status: 'Connection request', title: 'You decide\n*who connects*', sub: 'Disconnect an app any time. It has to ask before it comes back.' },
  stats: { status: 'Usage · last 7 days', title: 'See every\n*request*', sub: 'Requests and tokens for each key, model and app.' },
  macApp: { status: 'Extension on', title: 'Switch it\non *once*', sub: 'Open Byoky and turn on its extension. Then your wallet is one click away in the toolbar.' },
  phones: { status: 'iOS · Android', title: 'On your\n*phone* too', sub: 'Open any web app in the built-in browser. iPhone gets a Safari extension too.' },
  developers: { status: 'For developers', title: 'Your users\nbring the *keys*', sub: 'Keep the official SDKs and swap in Byoky’s fetch. Your app never holds a key.' },
} satisfies Record<string, Copy | ((s: string) => Copy)>;

// ── Stores ───────────────────────────────────────────────────────────────

const name = (n: number, slug: string, w: number, h: number) => `${String(n).padStart(2, '0')}-${slug}-${w}x${h}.png`;

async function chrome(kit: Kit): Promise<Record<string, Rendered[]>> {
  const ext = (f: string) => raw('store-extension', f);
  const slides: [string, string, Copy][] = [
    ['one-wallet', 'dashboard.png', COPY.wallet('your device')],
    ['approve-connections', 'approval.png', COPY.approve],
    ['limits-per-app', 'connected-apps-allowance.png', COPY.limits],
    ['route-providers', 'connected-apps-drag.png', COPY.route],
    ['locked-tight', 'unlock.png', COPY.locked],
  ];
  const chromeOut: Rendered[] = [];
  const firefoxOut: Rendered[] = [];
  for (const [i, [slug, shot, copy]] of slides.entries()) {
    const html = chromeSlide(ext(shot), copy);
    chromeOut.push(await kit.render(path.join(OUT, 'chrome', name(i + 1, slug, 1280, 800)), 1280, 800, html));
    firefoxOut.push(await kit.render(path.join(OUT, 'firefox', name(i + 1, slug, 1280, 800)), 1280, 800, html));
  }
  chromeOut.push(await kit.render(path.join(OUT, 'chrome', 'promo-small-440x280.png'), 440, 280, promoSmall()));
  chromeOut.push(await kit.render(path.join(OUT, 'chrome', 'promo-marquee-1400x560.png'), 1400, 560, promoMarquee(ext('dashboard.png'))));
  return { chrome: chromeOut, firefox: firefoxOut };
}

async function ios(kit: Kit): Promise<Rendered[]> {
  const out: Rendered[] = [];
  const iphone: [string, string, Copy][] = [
    ['one-wallet', 'iphone-wallet.png', COPY.wallet('your iPhone')],
    ['apps-connect', 'iphone-connected.png', COPY.connected],
    ['who-connects', 'iphone-reconnect.png', COPY.reconnect],
    ['limits-per-app', 'iphone-allowance.png', COPY.limits],
    ['route-providers', 'iphone-move-to-group.png', COPY.route],
    ['locked-tight', 'iphone-lock.png', COPY.locked],
  ];
  for (const [i, [slug, shot, copy]] of iphone.entries()) {
    out.push(await kit.render(path.join(OUT, 'ios', `iphone-${name(i + 1, slug, 1320, 2868)}`), 1320, 2868,
      portraitSlide(raw('store-ios', shot), copy, 'iphone', 1320, 2868, 1320, 2868)));
  }
  const ipad: [string, string, Copy][] = [
    ['one-wallet', 'ipad-wallet.png', COPY.wallet('your iPad')],
    ['apps-connect', 'ipad-connected.png', COPY.connected],
    ['every-request', 'ipad-stats.png', COPY.stats],
    ['who-connects', 'ipad-reconnect.png', COPY.reconnect],
    ['locked-tight', 'ipad-lock.png', COPY.locked],
  ];
  for (const [i, [slug, shot, copy]] of ipad.entries()) {
    out.push(await kit.render(path.join(OUT, 'ios', `ipad-${name(i + 1, slug, 2064, 2752)}`), 2064, 2752,
      portraitSlide(raw('store-ios', shot), copy, 'ipad', 2064, 2752, 2064, 2752)));
  }
  return out;
}

async function mac(kit: Kit): Promise<Rendered[]> {
  const ext = (f: string) => raw('store-extension', f);
  const demo = raw('store-web', 'demo-connect.png');
  const out: Rendered[] = [];
  const slides: [string, string][] = [
    ['one-wallet', macBrowserSlide(ext('dashboard.png'), COPY.wallet('your Mac'), demo)],
    ['approve-connections', macBrowserSlide(ext('approval.png'), COPY.approve, demo)],
    ['limits-per-app', macBrowserSlide(ext('connected-apps-allowance.png'), COPY.limits, demo)],
    ['route-providers', macBrowserSlide(ext('connected-apps-groups.png'), COPY.route, demo)],
    ['switch-on-once', macAppSlide(raw('store-mac', 'mac-app.png'), COPY.macApp)],
  ];
  for (const [i, [slug, html]] of slides.entries()) {
    out.push(await kit.render(path.join(OUT, 'mac', name(i + 1, slug, 2880, 1800)), 2880, 1800, html));
  }
  return out;
}

async function play(kit: Kit): Promise<Rendered[]> {
  const out: Rendered[] = [];
  const slides: [string, string, Copy][] = [
    ['one-wallet', 'wallet.png', COPY.wallet('your phone')],
    ['apps-connect', 'connected.png', COPY.connected],
    ['who-connects', 'reconnect.png', COPY.reconnect],
    ['limits-per-app', 'allowance.png', COPY.limits],
    ['route-providers', 'move-to-group.png', COPY.route],
    ['locked-tight', 'lock.png', COPY.locked],
  ];
  for (const [i, [slug, shot, copy]] of slides.entries()) {
    out.push(await kit.render(path.join(OUT, 'play', `phone-${name(i + 1, slug, 1080, 1920)}`), 1080, 1920,
      portraitSlide(raw('store-android', shot), copy, 'android', 1080, 1920, 1080, 2424)));
  }
  out.push(...(await buildPlayAssets(kit, path.join(OUT, 'play'))));
  return out;
}

async function producthunt(kit: Kit): Promise<Rendered[]> {
  const ext = (f: string) => raw('store-extension', f);
  const out: Rendered[] = [];
  const slides: [string, string][] = [
    ['one-wallet', phCover(ext('dashboard.png'))],
    ['approve-connections', chromeSlide(ext('approval.png'), COPY.approve, PH_W, PH_H)],
    ['limits-per-app', chromeSlide(ext('connected-apps-allowance.png'), COPY.limits, PH_W, PH_H)],
    ['route-providers', chromeSlide(ext('connected-apps-drag.png'), COPY.route, PH_W, PH_H)],
    ['on-your-phone', phPhones(raw('store-ios', 'iphone-wallet.png'), raw('store-android', 'connected.png'), COPY.phones)],
    ['for-developers', phDevelopers(COPY.developers)],
    ['locked-tight', chromeSlide(ext('unlock.png'), COPY.locked, PH_W, PH_H)],
  ];
  for (const [i, [slug, html]] of slides.entries()) {
    out.push(await kit.render(path.join(OUT, 'producthunt', name(i + 1, slug, PH_W, PH_H)), PH_W, PH_H, html));
  }
  // Thumbnail: the raven-head app icon, downscaled (not redrawn) from the web icon.
  const icon = path.join(ROOT, 'packages/web/public/icon-512.png');
  const meta = await sharp(icon).metadata();
  if (meta.width !== 512 || meta.height !== 512) throw new Error(`${icon}: ${meta.width}×${meta.height}, expected 512×512`);
  const thumb = path.join(OUT, 'producthunt', 'thumbnail-240x240.png');
  await sharp(icon).resize(240, 240, { kernel: 'lanczos3' }).flatten({ background: C.void }).removeAlpha().png({ compressionLevel: 9 }).toFile(thumb);
  console.log(`  ${path.relative(ROOT, thumb)}  240×240`);
  out.push({ file: thumb, width: 240, height: 240 });
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('\nComposing Byoky 1.1.1 store images…\n');
  const want = (s: string) => !ONLY || ONLY.includes(s);
  const kit = await Kit.open();
  const sets: Record<string, Rendered[]> = {};
  try {
    if (want('chrome') || want('firefox')) Object.assign(sets, await chrome(kit));
    if (want('ios')) sets.ios = await ios(kit);
    if (want('mac')) sets.mac = await mac(kit);
    if (want('play')) sets.play = await play(kit);
    if (want('producthunt')) sets.producthunt = await producthunt(kit);

    const titles: Record<string, string> = {
      chrome: 'Chrome Web Store', firefox: 'Firefox Add-ons', ios: 'App Store · iPhone 6.9" + iPad 13"', mac: 'Mac App Store', play: 'Google Play',
      producthunt: 'Product Hunt gallery + thumbnail',
    };
    fs.mkdirSync(CONTACT, { recursive: true });
    for (const [store, items] of Object.entries(sets)) {
      await kit.contactSheet(path.join(CONTACT, `${store}-contact-sheet.png`), titles[store], items);
    }
  } finally {
    await kit.close();
  }
  console.log(`\nDone: ${path.relative(ROOT, OUT)}/ (contact sheets in ${CONTACT})\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
