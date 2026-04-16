/**
 * Marketing composite generator.
 *
 * Reads frames from marketing/raw/ and emits final store-spec images to
 * marketing/composites/:
 *
 *   chrome-store-1280x800-*.png       (Chrome Web Store + Firefox AMO)
 *   chrome-promo-small-440x280.png    (Chrome Web Store small promo)
 *   chrome-promo-marquee-1400x560.png (Chrome Web Store marquee)
 *   ios-app-store-1320x2868-*.png     (Apple App Store 6.9")
 *   google-play-1080x1920-*.png       (Google Play phone portrait)
 *   product-hunt-cover-1270x760.png   (Product Hunt gallery)
 *   product-hunt-header-1200x630.png  (Product Hunt header)
 *   product-hunt-thumb-240x240.png    (Product Hunt thumbnail)
 *   eye-catcher-multi-1920x1080.png   (3-screen montage for social/PH)
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');
const RAW_POPUP = path.join(ROOT, 'marketing/raw/popup-frames');
const RAW_WEB = path.join(ROOT, 'marketing/raw/web');
const RAW_IOS = path.join(ROOT, 'marketing/raw/ios');
const RAW_ANDROID = path.join(ROOT, 'marketing/raw/android');
const OUT = path.join(ROOT, 'marketing/composites');
const ASSETS = path.join(ROOT, 'marketing/assets');
const LOGO = path.join(ROOT, 'packages/extension/public/icon.svg');

fs.mkdirSync(OUT, { recursive: true });

// ── Brand ────────────────────────────────────────────────────────────────
const BRAND = {
  bg: '#141418',
  bgRaised: '#1c1c22',
  accent: '#0ea5e9',
  accentLight: '#7dd3fc',
  text: '#f5f5f7',
  textMuted: '#8e8e9a',
};

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif';

// ── Helpers ──────────────────────────────────────────────────────────────
function svgEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Slide {
  headline: string;
  sub?: string;
  popupFrame?: string;       // file in raw/popup-frames
  webFrame?: string;         // file in raw/web
  mobileFrame?: string;      // file in raw/ios or raw/android
  device?: 'phone-ios' | 'phone-android' | 'browser';
}

/** Render a multi-line text block as SVG (used as Sharp overlay). */
function textOverlay(opts: {
  width: number;
  height: number;
  headline: string;
  sub?: string;
  align?: 'left' | 'center';
  headlineSize?: number;
  subSize?: number;
  color?: string;
  subColor?: string;
}): Buffer {
  const align = opts.align ?? 'center';
  const x = align === 'left' ? 60 : opts.width / 2;
  const anchor = align === 'left' ? 'start' : 'middle';
  const hs = opts.headlineSize ?? 56;
  const ss = opts.subSize ?? 24;
  const color = opts.color ?? BRAND.text;
  const subColor = opts.subColor ?? BRAND.textMuted;

  const headlineLines = opts.headline.split('\n');
  const headlineY = opts.height / 2 - (headlineLines.length - 1) * hs * 0.6;
  const headlineSvg = headlineLines
    .map(
      (line, i) =>
        `<text x="${x}" y="${headlineY + i * hs * 1.2}" text-anchor="${anchor}" font-family='${FONT_STACK}' font-size="${hs}" font-weight="700" fill="${color}" letter-spacing="-1">${svgEscape(line)}</text>`,
    )
    .join('');
  const subSvg = opts.sub
    ? `<text x="${x}" y="${headlineY + headlineLines.length * hs * 1.2 + ss * 0.6}" text-anchor="${anchor}" font-family='${FONT_STACK}' font-size="${ss}" font-weight="400" fill="${subColor}">${svgEscape(opts.sub)}</text>`
    : '';

  const svg = `<svg width="${opts.width}" height="${opts.height}" xmlns="http://www.w3.org/2000/svg">${headlineSvg}${subSvg}</svg>`;
  return Buffer.from(svg);
}

/** Gradient backdrop with subtle grid and a soft accent glow. */
function backdrop(width: number, height: number): Buffer {
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="40%" r="65%">
      <stop offset="0%" stop-color="${BRAND.accent}" stop-opacity="0.25"/>
      <stop offset="60%" stop-color="${BRAND.accent}" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="${BRAND.bg}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${BRAND.text}" stroke-opacity="0.04" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${BRAND.bg}"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
</svg>`;
  return Buffer.from(svg);
}

/** Round-rect shadowed device frame around a screenshot. Optionally caps the
 * resulting framed height — useful when laying out within a fixed canvas. */
async function deviceFrame(
  pngPath: string,
  opts: { kind: 'browser' | 'phone-ios' | 'phone-android'; targetWidth: number; maxHeight?: number },
): Promise<sharp.Sharp> {
  const inner = sharp(pngPath);
  const meta = await inner.metadata();
  const innerW = meta.width!;
  const innerH = meta.height!;
  const ratio = innerH / innerW;
  let w = opts.targetWidth;
  let h = Math.round(w * ratio);

  // Account for chrome / bezel additions when computing maxHeight.
  if (opts.maxHeight) {
    const overhead = opts.kind === 'browser' ? 32 : opts.kind === 'phone-ios' || opts.kind === 'phone-android' ? 36 : 0;
    if (h + overhead > opts.maxHeight) {
      h = opts.maxHeight - overhead;
      w = Math.round(h / ratio);
    }
  }

  // Resize the screenshot to target
  const resized = await sharp(pngPath).resize(w, h, { fit: 'fill' }).png().toBuffer();

  if (opts.kind === 'browser') {
    // Add a tiny browser chrome with traffic lights
    const chromeH = 32;
    const totalH = h + chromeH;
    const chromeSvg = `
<svg width="${w}" height="${chromeH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${chromeH}" fill="#2a2a34"/>
  <circle cx="16" cy="${chromeH / 2}" r="6" fill="#ff5f57"/>
  <circle cx="36" cy="${chromeH / 2}" r="6" fill="#febc2e"/>
  <circle cx="56" cy="${chromeH / 2}" r="6" fill="#28c840"/>
  <rect x="${w / 2 - 120}" y="${chromeH / 2 - 9}" width="240" height="18" rx="9" fill="#1c1c22"/>
</svg>`;
    return sharp({
      create: {
        width: w,
        height: totalH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: Buffer.from(chromeSvg), top: 0, left: 0 },
        { input: resized, top: chromeH, left: 0 },
      ])
      .png();
  }

  if (opts.kind === 'phone-ios' || opts.kind === 'phone-android') {
    // Simulator screenshots already contain the iPhone-style rounded screen
    // corners + status bar — adding a faux bezel on top looks like a frame
    // around a frame. Instead: soft-round the outer corners (matches device
    // display corner radius) and drop a subtle transparent shadow via a
    // slightly larger transparent canvas. No gradient bezel rectangle.
    const cornerRadius = Math.round(w * 0.06);
    const pad = 6; // just enough breathing room for a drop-shadow halo
    const totalW = w + pad * 2;
    const totalH = h + pad * 2;

    // Rounded-corner mask applied to the resized screenshot.
    const maskSvg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${cornerRadius}" ry="${cornerRadius}" fill="white"/></svg>`;
    const masked = await sharp(resized)
      .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
      .png()
      .toBuffer();

    // Transparent canvas with subtle dark halo behind the phone.
    const shadowSvg = `<svg width="${totalW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg"><rect x="${pad}" y="${pad}" width="${w}" height="${h}" rx="${cornerRadius}" ry="${cornerRadius}" fill="black" fill-opacity="0.35"/></svg>`;
    const shadow = await sharp(Buffer.from(shadowSvg)).blur(12).png().toBuffer();

    return sharp({
      create: {
        width: totalW,
        height: totalH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: shadow, top: 0, left: 0 },
        { input: masked, top: pad, left: pad },
      ])
      .png();
  }

  return sharp(resized);
}

// ── Composers ────────────────────────────────────────────────────────────

/**
 * Chrome Web Store / Firefox AMO screenshot — 1280×800.
 * Layout: 60% device frame (popup centered), 40% headline+sub on the right.
 */
async function chromeStoreSlide(slide: Slide, idx: number, suffix = 'chrome-store') {
  const W = 1280;
  const H = 800;
  if (!slide.popupFrame) return;
  const popupPath = path.join(RAW_POPUP, slide.popupFrame);
  if (!fs.existsSync(popupPath)) {
    console.warn(`  ⚠ skipped slide ${idx} — missing ${slide.popupFrame}`);
    return;
  }

  const back = await sharp(backdrop(W, H)).png().toBuffer();
  // Popup at 520px wide → ~40% of the 1280 canvas. Previously 380 (30%)
  // felt tiny in the video at any embed size; bigger popup means the UI
  // inside is actually readable.
  const popupFramed = await (await deviceFrame(popupPath, { kind: 'browser', targetWidth: 520, maxHeight: 760 })).toBuffer();
  const popupMeta = await sharp(popupFramed).metadata();

  const popupX = 100;
  // Clamp Y to keep the framed popup inside the canvas
  let popupY = Math.round((H - popupMeta.height!) / 2);
  if (popupY < 0) popupY = 0;
  // If popup taller than canvas, scale down further (defensive)
  if (popupMeta.height! > H) {
    const scale = (H - 20) / popupMeta.height!;
    const newW = Math.round(popupMeta.width! * scale);
    const newH = Math.round(popupMeta.height! * scale);
    const rescaled = await sharp(popupFramed).resize(newW, newH).png().toBuffer();
    return chromeStoreSlideFinal(rescaled, newW, newH, slide, idx, suffix, back, W, H, popupX);
  }

  const text = textOverlay({
    width: W - popupMeta.width! - popupX - 80,
    height: H,
    headline: slide.headline,
    sub: slide.sub,
    align: 'left',
    headlineSize: 56,
    subSize: 22,
  });

  const out = path.join(OUT, `${suffix}-${String(idx + 1).padStart(2, '0')}-1280x800.png`);
  const composites = [
    { input: popupFramed, top: popupY, left: popupX },
    { input: text, top: 0, left: popupX + popupMeta.width! + 40 },
  ];
  await sharp(back).composite(composites).flatten({ background: BRAND.bg }).jpeg({ quality: 95 }).toFile(out.replace('.png', '.jpg'));
  await sharp(back).composite(composites).png().toFile(out);
  console.log(`  🎨 ${path.basename(out)}`);
}

async function chromeStoreSlideFinal(
  popupFramed: Buffer,
  popupW: number,
  popupH: number,
  slide: Slide,
  idx: number,
  suffix: string,
  back: Buffer,
  W: number,
  H: number,
  popupX: number,
) {
  const popupY = Math.round((H - popupH) / 2);
  const text = textOverlay({
    width: W - popupW - popupX - 80,
    height: H,
    headline: slide.headline,
    sub: slide.sub,
    align: 'left',
    headlineSize: 56,
    subSize: 22,
  });
  const out = path.join(OUT, `${suffix}-${String(idx + 1).padStart(2, '0')}-1280x800.png`);
  const composites = [
    { input: popupFramed, top: popupY, left: popupX },
    { input: text, top: 0, left: popupX + popupW + 40 },
  ];
  await sharp(back).composite(composites).flatten({ background: BRAND.bg }).jpeg({ quality: 95 }).toFile(out.replace('.png', '.jpg'));
  await sharp(back).composite(composites).png().toFile(out);
  console.log(`  🎨 ${path.basename(out)}`);
}

/**
 * Mobile App Store screenshot (iOS portrait 1320×2868 or Android 1080×1920).
 */
async function mobileStoreSlide(slide: Slide, idx: number, kind: 'ios' | 'android') {
  const W = kind === 'ios' ? 1320 : 1080;
  const H = kind === 'ios' ? 2868 : 1920;
  const sourceDir = kind === 'ios' ? RAW_IOS : RAW_ANDROID;
  if (!slide.mobileFrame) return;
  const framePath = path.join(sourceDir, slide.mobileFrame);
  if (!fs.existsSync(framePath)) {
    console.warn(`  ⚠ skipped ${kind} slide ${idx} — missing ${slide.mobileFrame}`);
    return;
  }

  const back = await sharp(backdrop(W, H)).png().toBuffer();
  // Headline at top
  const headlineH = Math.round(H * 0.18);
  const headline = textOverlay({
    width: W,
    height: headlineH,
    headline: slide.headline,
    sub: slide.sub,
    align: 'center',
    headlineSize: kind === 'ios' ? 96 : 76,
    subSize: kind === 'ios' ? 40 : 32,
  });

  // Mobile screenshot fills the rest
  const phoneTargetW = Math.round(W * 0.78);
  const framed = await (
    await deviceFrame(framePath, { kind: kind === 'ios' ? 'phone-ios' : 'phone-android', targetWidth: phoneTargetW })
  ).toBuffer();
  const framedMeta = await sharp(framed).metadata();
  const phoneX = Math.round((W - framedMeta.width!) / 2);
  const phoneY = headlineH + 40;

  const filename = `${kind}-app-store-${String(idx + 1).padStart(2, '0')}-${W}x${H}.png`;
  const out = path.join(OUT, filename);
  await sharp(back)
    .composite([
      { input: headline, top: 0, left: 0 },
      { input: framed, top: phoneY, left: phoneX },
    ])
    .flatten({ background: BRAND.bg })
    .jpeg({ quality: 92 })
    .toFile(out.replace('.png', '.jpg'));
  await sharp(back)
    .composite([
      { input: headline, top: 0, left: 0 },
      { input: framed, top: phoneY, left: phoneX },
    ])
    .png()
    .toFile(out);
  console.log(`  🎨 ${filename}`);
}

/**
 * Product Hunt gallery cover (1270×760) — three-screen montage.
 */
async function productHuntCover() {
  const W = 1270;
  const H = 760;
  const back = await sharp(backdrop(W, H)).png().toBuffer();

  const overlays: sharp.OverlayOptions[] = [];

  // Headline anchored top
  const HEADLINE_BAND = 200;
  const headline = textOverlay({
    width: W,
    height: HEADLINE_BAND,
    headline: 'Bring Your Own Key',
    sub: 'Your AI keys, your wallet, your rules — across every browser and phone.',
    align: 'center',
    headlineSize: 56,
    subSize: 20,
  });
  overlays.push({ input: headline, top: 0, left: 0 });

  // Three devices: phone left, browser center (popup), phone right.
  // If phones missing, use popup variants as stand-ins so we still render
  // a 3-up montage instead of a lonely center.
  const center = firstExisting([
    path.join(RAW_POPUP, '09-dashboard-multi-provider.png'),
    path.join(RAW_POPUP, '08-dashboard-with-anthropic.png'),
    path.join(RAW_POPUP, '16-dashboard-final.png'),
  ]) ?? path.join(RAW_POPUP, '09-dashboard-multi-provider.png');
  const iosFrame = firstExisting([path.join(RAW_IOS, '02-dashboard.png'), path.join(RAW_IOS, '01-onboarding.png')]);
  const androidFrame = firstExisting([
    path.join(RAW_ANDROID, '04-dashboard-with-key.png'),
    path.join(RAW_ANDROID, '01-onboarding.png'),
  ]);
  const popupAlt1 = firstExisting([path.join(RAW_POPUP, '11-create-gift.png'), path.join(RAW_POPUP, '10-gifts-empty.png')]);
  const popupAlt2 = firstExisting([path.join(RAW_POPUP, '13-activity.png'), path.join(RAW_POPUP, '14-usage.png')]);
  const left = iosFrame ?? popupAlt1 ?? center;
  const right = androidFrame ?? popupAlt2 ?? center;
  const leftKind: 'phone-ios' | 'browser' = iosFrame ? 'phone-ios' : 'browser';
  const rightKind: 'phone-android' | 'browser' = androidFrame ? 'phone-android' : 'browser';

  // Vertically position devices BELOW the headline band (top = HEADLINE_BAND)
  const deviceBandTop = HEADLINE_BAND + 10;
  const deviceBandHeight = H - deviceBandTop - 30;

  if (fs.existsSync(center)) {
    const framed = await (await deviceFrame(center, { kind: 'browser', targetWidth: 360, maxHeight: deviceBandHeight })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({
      input: framed,
      top: deviceBandTop + Math.round((deviceBandHeight - meta.height!) / 2),
      left: Math.round(W / 2 - meta.width! / 2),
    });
  }
  if (left && fs.existsSync(left)) {
    const framed = await (await deviceFrame(left, { kind: leftKind, targetWidth: 200, maxHeight: deviceBandHeight - 20 })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({
      input: framed,
      top: deviceBandTop + Math.round((deviceBandHeight - meta.height!) / 2),
      left: 60,
    });
  }
  if (right && fs.existsSync(right)) {
    const framed = await (await deviceFrame(right, { kind: rightKind, targetWidth: 200, maxHeight: deviceBandHeight - 20 })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({
      input: framed,
      top: deviceBandTop + Math.round((deviceBandHeight - meta.height!) / 2),
      left: W - meta.width! - 60,
    });
  }

  // Logo bottom-right
  if (fs.existsSync(LOGO)) {
    const logo = await sharp(LOGO).resize(56, 56).png().toBuffer();
    overlays.push({ input: logo, top: H - 80, left: W - 80 });
  }

  await sharp(back).composite(overlays).png().toFile(path.join(OUT, 'product-hunt-cover-1270x760.png'));
  console.log('  🎨 product-hunt-cover-1270x760.png');

  // Header (1200×630)
  // Layout bands (top → bottom):
  //   0..240   text band (headline + subtitle)
  //   240..320 breathing room gap (~80px)
  //   320..600 screenshot band (max 280 tall → leaves 30px bottom margin)
  const HW = 1200;
  const HH = 630;
  const headerBack = await sharp(backdrop(HW, HH)).png().toBuffer();
  const headerOverlays: sharp.OverlayOptions[] = [];
  const headerText = textOverlay({
    width: HW,
    height: 240,
    headline: 'Bring Your Own Key',
    sub: 'A wallet for your AI API keys.',
    align: 'center',
    headlineSize: 72,
    subSize: 24,
  });
  headerOverlays.push({ input: headerText, top: 30, left: 0 });
  if (fs.existsSync(center)) {
    // Shrink + anchor to the bottom band; bottom margin 30px means top sits at
    // (HH - meta.height - 30). With maxHeight=240 the screenshot can't
    // protrude into the text band above (≤240 tall starting at ≥360 → bottom
    // is ≤600, leaving ≥120px gap below text end at y=270).
    const framed = await (await deviceFrame(center, { kind: 'browser', targetWidth: 200, maxHeight: 240 })).toBuffer();
    const meta = await sharp(framed).metadata();
    headerOverlays.push({ input: framed, top: HH - meta.height! - 30, left: Math.round(HW / 2 - meta.width! / 2) });
  }
  await sharp(headerBack).composite(headerOverlays).png().toFile(path.join(OUT, 'product-hunt-header-1200x630.png'));
  console.log('  🎨 product-hunt-header-1200x630.png');

  // Thumbnail (240×240)
  const TW = 240;
  const thumbBack = await sharp(backdrop(TW, TW)).png().toBuffer();
  const thumbOverlays: sharp.OverlayOptions[] = [];
  if (fs.existsSync(LOGO)) {
    const logo = await sharp(LOGO).resize(160, 160).png().toBuffer();
    thumbOverlays.push({ input: logo, top: 40, left: 40 });
  }
  await sharp(thumbBack).composite(thumbOverlays).png().toFile(path.join(OUT, 'product-hunt-thumb-240x240.png'));
  console.log('  🎨 product-hunt-thumb-240x240.png');
}

/**
 * Eye-catcher — 1920×1080 multi-screen hero for social posts.
 * 3-up: phone (iOS) | browser (popup) | phone (Android).
 */
async function eyeCatcher() {
  const W = 1920;
  const H = 1080;
  const back = await sharp(backdrop(W, H)).png().toBuffer();

  const overlays: sharp.OverlayOptions[] = [];

  const headline = textOverlay({
    width: W,
    height: 220,
    headline: 'One wallet. Every AI provider. Any device.',
    sub: 'Your API keys never leave your browser. Send a gift instead.',
    align: 'center',
    headlineSize: 64,
    subSize: 26,
  });
  overlays.push({ input: headline, top: 30, left: 0 });

  const popup = firstExisting([
    path.join(RAW_POPUP, '09-dashboard-multi-provider.png'),
    path.join(RAW_POPUP, '08-dashboard-with-anthropic.png'),
    path.join(RAW_POPUP, '16-dashboard-final.png'),
  ]);
  const popupGifts = firstExisting([path.join(RAW_POPUP, '11-create-gift.png'), path.join(RAW_POPUP, '10-gifts-empty.png')]);
  const popupActivity = firstExisting([path.join(RAW_POPUP, '13-activity.png'), path.join(RAW_POPUP, '14-usage.png')]);
  const iosFrame = firstExisting([path.join(RAW_IOS, '02-dashboard.png'), path.join(RAW_IOS, '01-onboarding.png')]);
  const androidFrame = firstExisting([
    path.join(RAW_ANDROID, '04-dashboard-with-key.png'),
    path.join(RAW_ANDROID, '02-dashboard-empty.png'),
  ]);
  // Fall back to popup variants when mobile frames not available
  const ios = iosFrame ?? popupGifts;
  const android = androidFrame ?? popupActivity;
  const iosKind: 'phone-ios' | 'browser' = iosFrame ? 'phone-ios' : 'browser';
  const androidKind: 'phone-android' | 'browser' = androidFrame ? 'phone-android' : 'browser';
  const web = firstExisting([
    path.join(RAW_WEB, 'demo-1920x1080-hero.png'),
    path.join(RAW_WEB, 'landing-1920x1080-hero.png'),
  ]);

  // Center-large: web demo. Flanked by phones + popup.
  if (web && fs.existsSync(web)) {
    const framed = await (await deviceFrame(web, { kind: 'browser', targetWidth: 900, maxHeight: 760 })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({
      input: framed,
      top: Math.round(H / 2 - meta.height! / 2 + 80),
      left: Math.round(W / 2 - meta.width! / 2),
    });
  }

  if (ios && fs.existsSync(ios)) {
    const framed = await (await deviceFrame(ios, { kind: iosKind, targetWidth: 240, maxHeight: 720 })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({ input: framed, top: Math.round(H / 2 - meta.height! / 2 + 100), left: 100 });
  }

  if (android && fs.existsSync(android)) {
    const framed = await (await deviceFrame(android, { kind: androidKind, targetWidth: 240, maxHeight: 720 })).toBuffer();
    const meta = await sharp(framed).metadata();
    overlays.push({ input: framed, top: Math.round(H / 2 - meta.height! / 2 + 100), left: W - meta.width! - 100 });
  }

  await sharp(back).composite(overlays).png().toFile(path.join(OUT, 'eye-catcher-multi-1920x1080.png'));
  console.log('  🎨 eye-catcher-multi-1920x1080.png');
}

/**
 * Chrome Web Store small promo tile (440×280) and marquee (1400×560).
 */
async function chromePromo() {
  for (const [w, h, name] of [[440, 280, 'small'], [1400, 560, 'marquee']] as const) {
    const back = await sharp(backdrop(w, h)).png().toBuffer();
    const overlays: sharp.OverlayOptions[] = [];

    const fontHeadline = name === 'marquee' ? 80 : 36;
    const fontSub = name === 'marquee' ? 28 : 14;
    const text = textOverlay({
      width: w,
      height: h,
      headline: name === 'marquee' ? 'Your AI keys.\nYour wallet.' : 'Byoky',
      sub: name === 'marquee' ? 'Bring Your Own Key — for every AI app, every device.' : 'BYOK wallet for AI',
      align: name === 'marquee' ? 'left' : 'center',
      headlineSize: fontHeadline,
      subSize: fontSub,
    });
    overlays.push({ input: text, top: 0, left: 0 });

    if (fs.existsSync(LOGO)) {
      const logoSize = name === 'marquee' ? 120 : 64;
      const logo = await sharp(LOGO).resize(logoSize, logoSize).png().toBuffer();
      overlays.push({
        input: logo,
        top: Math.round((h - logoSize) / 2),
        left: name === 'marquee' ? w - logoSize - 60 : 20,
      });
    }

    await sharp(back).composite(overlays).png().toFile(path.join(OUT, `chrome-promo-${name}-${w}x${h}.png`));
    console.log(`  🎨 chrome-promo-${name}-${w}x${h}.png`);
  }
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => fs.existsSync(p));
}

// ── Run ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n📐 Composing marketing assets...\n');

  // Chrome / Firefox Web Store slides — same 1280×800 spec
  const chromeSlides: Slide[] = [
    {
      headline: 'Your AI keys.\nYour wallet.',
      sub: 'Local-first, encrypted with AES-256. Keys never leave your browser.',
      popupFrame: '08-dashboard-with-anthropic.png',
    },
    {
      headline: 'One key,\nevery provider.',
      sub: 'Anthropic, OpenAI, Gemini, and any OpenAI-compatible endpoint.',
      popupFrame: '09-dashboard-multi-provider.png',
    },
    {
      headline: 'Send AI as a gift.',
      sub: 'Mint a token-budgeted key for a friend. Revoke anytime.',
      popupFrame: '11b-create-gift-submit.png',
    },
    {
      headline: 'See every request.',
      sub: 'Real-time activity log, token usage, per-app spend.',
      popupFrame: '13-activity.png',
    },
    {
      headline: 'Apps you control.',
      sub: 'Approve once, revoke anytime. Per-app limits.',
      popupFrame: '12-apps.png',
    },
    {
      headline: 'Total visibility.',
      sub: 'Track tokens used by every app, every model, every day.',
      popupFrame: '14-usage.png',
    },
  ];
  for (let i = 0; i < chromeSlides.length; i++) {
    await chromeStoreSlide(chromeSlides[i], i, 'chrome-store');
    await chromeStoreSlide(chromeSlides[i], i, 'firefox-amo');
  }

  // iOS App Store slides (Safari extension lives inside this app)
  const iosSlides: Slide[] = [
    { headline: 'Your AI wallet.', sub: 'On your iPhone.', mobileFrame: '02-dashboard.png' },
    { headline: 'Send a gift.', sub: 'Share AI access with anyone.', mobileFrame: '05-create-gift-form.png' },
    { headline: 'Set a budget.', sub: 'Token-capped. Time-bound.', mobileFrame: '06-create-gift-filled.png' },
    { headline: 'Tap, share, done.', sub: 'A link they can redeem in seconds.', mobileFrame: '07-gift-link-ready.png' },
    { headline: 'Track every gift.', sub: 'See who used what, in real time.', mobileFrame: '08-gifts-with-sent-gift.png' },
    { headline: 'Stay in control.', sub: 'Revoke any time.', mobileFrame: '09-dashboard-final.png' },
  ];
  for (let i = 0; i < iosSlides.length; i++) {
    await mobileStoreSlide(iosSlides[i], i, 'ios');
  }

  // Android (Google Play) slides
  const androidSlides: Slide[] = [
    { headline: 'Your AI wallet.', sub: 'On Android.', mobileFrame: '04-dashboard-with-key.png' },
    { headline: 'Share access,\nnot keys.', sub: 'Token-budgeted gift links.', mobileFrame: '10-gifts-empty.png' },
    { headline: 'Set a budget.', sub: 'Pick a cap. Pick a window.', mobileFrame: '05-create-gift.png' },
    { headline: 'Apps you control.', sub: 'Approve once, revoke anytime.', mobileFrame: '12-apps.png' },
    { headline: 'Total visibility.', sub: 'Tokens, requests, spend.', mobileFrame: '14-usage.png' },
  ];
  for (let i = 0; i < androidSlides.length; i++) {
    await mobileStoreSlide(androidSlides[i], i, 'android');
  }

  await chromePromo();
  await productHuntCover();
  await eyeCatcher();

  console.log(`\n✓ Composites written to ${OUT}\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
