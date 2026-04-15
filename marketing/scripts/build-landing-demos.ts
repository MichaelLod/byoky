/**
 * Build the 4 demo loops for the landing page (packages/web/public/demos/).
 *
 * Each demo is a 6-8s silent autoplay loop at 1200×690 that shows ONE punchy
 * feature using frames we already captured in marketing/raw/. Crossfades,
 * subtle zooms, and a short caption make them feel designed instead of
 * "screen recordings with jitter".
 *
 * Run: pnpm -C marketing tsx scripts/build-landing-demos.ts
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '../..');
const POPUP = path.join(ROOT, 'marketing/raw/popup-frames');
const IOS = path.join(ROOT, 'marketing/raw/ios');
const WEB = path.join(ROOT, 'marketing/raw/web');
const OUT = path.join(ROOT, 'packages/web/public/demos');
const TMP = path.join(ROOT, 'marketing/.cache/landing');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// Match the existing dimensions so CSS/layout doesn't need tweaks.
const W = 1200;
const H = 690;
const FPS = 30;

// Brand
const BG = '#141418';
const ACCENT = '#0ea5e9';
const FONT = '/System/Library/Fonts/SFNS.ttf';

interface Shot {
  /** Path to source image */
  src: string;
  /** Centered caption (empty = no caption) */
  caption?: string;
  /** Duration in seconds */
  dur: number;
  /** How to frame the image: 'browser' puts it in a window chrome; 'phone' soft-rounds; 'full' fills */
  frame?: 'browser' | 'phone' | 'full';
}

interface Demo {
  name: string;
  shots: Shot[];
}

const DEMOS: Demo[] = [
  {
    name: 'hero-demo',
    shots: [
      { src: path.join(POPUP, '01-welcome.png'), caption: 'Install once', dur: 2.2, frame: 'browser' },
      { src: path.join(POPUP, '08-dashboard-with-anthropic.png'), caption: 'Drop in your key', dur: 2.4, frame: 'browser' },
      { src: path.join(POPUP, '09-dashboard-multi-provider.png'), caption: 'You\'re connected', dur: 2.6, frame: 'browser' },
    ],
  },
  {
    name: 'cross-provider',
    shots: [
      { src: path.join(POPUP, '09-dashboard-multi-provider.png'), caption: 'One wallet', dur: 2.2, frame: 'browser' },
      { src: path.join(POPUP, '12-apps.png'), caption: 'Every connected app', dur: 2.4, frame: 'browser' },
      { src: path.join(POPUP, '13-activity.png'), caption: 'Full visibility', dur: 2.6, frame: 'browser' },
    ],
  },
  {
    name: 'mobile-qr',
    shots: [
      { src: path.join(IOS, '02-dashboard.png'), caption: 'Your wallet on iPhone', dur: 2.4, frame: 'phone' },
      { src: path.join(IOS, '07-gift-link-ready.png'), caption: 'Gift a key', dur: 2.4, frame: 'phone' },
      { src: path.join(IOS, '08-gifts-with-sent-gift.png'), caption: 'Track every share', dur: 2.4, frame: 'phone' },
    ],
  },
  {
    name: 'token-gift',
    shots: [
      { src: path.join(POPUP, '10-gifts-empty.png'), caption: 'Want to share AI?', dur: 2.2, frame: 'browser' },
      { src: path.join(POPUP, '11-create-gift.png'), caption: 'Set a token budget', dur: 2.4, frame: 'browser' },
      { src: path.join(POPUP, '11b-create-gift-submit.png'), caption: 'Send. Revoke any time.', dur: 2.4, frame: 'browser' },
    ],
  },
];

// ── Backdrop with brand gradient + grid ──────────────────────────────────
async function makeBackdrop(): Promise<string> {
  const file = path.join(TMP, 'backdrop.png');
  const svg = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="${ACCENT}" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="${BG}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#ffffff" stroke-opacity="0.03" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="${BG}"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

// ── Render one shot: image + frame + caption centered on backdrop ─────────
async function renderShot(shot: Shot, backdrop: string, idx: number, demoName: string): Promise<string> {
  const outFile = path.join(TMP, `${demoName}-shot${idx}.png`);
  if (!fs.existsSync(shot.src)) {
    console.warn(`  ⚠ missing ${shot.src} — substituting backdrop only`);
    await sharp(backdrop).png().toFile(outFile);
    return outFile;
  }

  // Decide target size for the asset within the 1200×690 frame.
  const meta = await sharp(shot.src).metadata();
  const iw = meta.width!;
  const ih = meta.height!;
  const imageAspect = iw / ih;

  let targetW: number;
  let targetH: number;
  if (shot.frame === 'phone') {
    // Portrait phone: fit to ~80% of H
    targetH = Math.round(H * 0.82);
    targetW = Math.round(targetH * imageAspect);
  } else {
    // Browser/full: fit to 70% of W keeping aspect
    targetW = Math.round(W * 0.58);
    targetH = Math.round(targetW / imageAspect);
    if (targetH > H * 0.82) {
      targetH = Math.round(H * 0.82);
      targetW = Math.round(targetH * imageAspect);
    }
  }

  let image = sharp(shot.src).resize(targetW, targetH, { fit: 'fill' });

  // Rounded-corner mask for the image
  const cornerRadius = shot.frame === 'phone' ? Math.round(targetW * 0.08) : 12;
  const maskSvg = `<svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg"><rect width="${targetW}" height="${targetH}" rx="${cornerRadius}" ry="${cornerRadius}" fill="white"/></svg>`;
  const masked = await image.composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }]).png().toBuffer();

  // Optional browser chrome for 'browser' frames
  let finalAsset = masked;
  let finalW = targetW;
  let finalH = targetH;
  if (shot.frame === 'browser') {
    const chromeH = 28;
    const chromeSvg = `
<svg width="${targetW}" height="${chromeH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${targetW}" height="${chromeH}" rx="12" ry="12" fill="#2a2a34"/>
  <rect y="${chromeH / 2}" width="${targetW}" height="${chromeH / 2}" fill="#2a2a34"/>
  <circle cx="14" cy="${chromeH / 2}" r="5" fill="#ff5f57"/>
  <circle cx="30" cy="${chromeH / 2}" r="5" fill="#febc2e"/>
  <circle cx="46" cy="${chromeH / 2}" r="5" fill="#28c840"/>
</svg>`;
    finalH = targetH + chromeH;
    const withChrome = await sharp({
      create: { width: targetW, height: finalH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        { input: Buffer.from(chromeSvg), top: 0, left: 0 },
        { input: masked, top: chromeH, left: 0 },
      ])
      .png()
      .toBuffer();
    finalAsset = withChrome;
  }

  // Place asset on backdrop, caption at bottom
  const compositeItems: sharp.OverlayOptions[] = [
    {
      input: finalAsset,
      top: Math.round((H - finalH) / 2 - 30),
      left: Math.round((W - finalW) / 2),
    },
  ];

  if (shot.caption) {
    const captionH = 60;
    const captionY = H - captionH - 30;
    const captionSvg = `
<svg width="${W}" height="${captionH}" xmlns="http://www.w3.org/2000/svg">
  <text x="${W / 2}" y="${captionH / 2 + 10}"
    text-anchor="middle"
    font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif"
    font-size="28" font-weight="600"
    fill="#f5f5f7" letter-spacing="-0.3">${shot.caption.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>
</svg>`;
    compositeItems.push({ input: Buffer.from(captionSvg), top: captionY, left: 0 });
  }

  await sharp(backdrop).composite(compositeItems).png().toFile(outFile);
  return outFile;
}

// ── Build one demo by crossfading shots together ─────────────────────────
async function buildDemo(demo: Demo, backdrop: string): Promise<void> {
  console.log(`\n🎬 ${demo.name}`);

  // Render all shots as static PNGs
  const shotImages: { file: string; dur: number }[] = [];
  for (let i = 0; i < demo.shots.length; i++) {
    const file = await renderShot(demo.shots[i], backdrop, i, demo.name);
    shotImages.push({ file, dur: demo.shots[i].dur });
    console.log(`  🖼  shot ${i} rendered (${demo.shots[i].dur.toFixed(1)}s)`);
  }

  // Per-shot MP4s with subtle zoom (1.00 → 1.03). Use scale+lanczos+eval=frame
  // instead of zoompan — zoompan rounds crop offsets to integers each frame,
  // producing visible 1px wobble ("shake"). scale+lanczos interpolates at
  // sub-pixel precision so motion is actually smooth.
  const shotClips: string[] = [];
  for (let i = 0; i < shotImages.length; i++) {
    const { file, dur } = shotImages[i];
    const clipOut = path.join(TMP, `${demo.name}-clip${i}.mp4`);
    const zoomExpr = `1.0+0.03*t/${dur.toFixed(2)}`;
    const filter = [
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}[main]`,
      `[main]scale=w='${W}*${zoomExpr}':h='${H}*${zoomExpr}':flags=lanczos:eval=frame,crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})/2,fps=${FPS},format=yuv420p[out]`,
    ].join(';');
    // Target 2M VBR with a 1.5M floor — CRF alone lets bitrate collapse
    // to ~250 kb/s on our dark frames (visibly pixelated when scaled up
    // in the landing-page grid).
    execSync(
      `ffmpeg -y -loop 1 -i "${file}" -t ${dur.toFixed(2)} -filter_complex "${filter}" -map "[out]" -c:v libx264 -pix_fmt yuv420p -r ${FPS} -preset medium -b:v 2M -minrate 1500k -maxrate 3M -bufsize 6M "${clipOut}"`,
      { stdio: 'pipe' },
    );
    shotClips.push(clipOut);
  }

  // Crossfade them together (0.4s fades between shots).
  // xfade inputs must be offset-based: offset = sum of prior durations minus fade duration.
  const fadeDur = 0.4;
  let current = shotClips[0];
  let cumulativeDur = shotImages[0].dur;
  for (let i = 1; i < shotClips.length; i++) {
    const next = shotClips[i];
    const offset = cumulativeDur - fadeDur;
    const combined = path.join(TMP, `${demo.name}-xfade${i}.mp4`);
    execSync(
      `ffmpeg -y -i "${current}" -i "${next}" -filter_complex "[0:v][1:v]xfade=transition=fade:duration=${fadeDur}:offset=${offset.toFixed(2)},format=yuv420p" -c:v libx264 -pix_fmt yuv420p -preset medium -b:v 2M -minrate 1500k -maxrate 3M -bufsize 6M -r ${FPS} "${combined}"`,
      { stdio: 'pipe' },
    );
    current = combined;
    cumulativeDur += shotImages[i].dur - fadeDur;
  }

  // Final: loop-friendly fade-in/out bookends
  const final = path.join(OUT, `${demo.name}.mp4`);
  execSync(
    `ffmpeg -y -i "${current}" -vf "fade=t=in:st=0:d=0.3,fade=t=out:st=${(cumulativeDur - 0.3).toFixed(2)}:d=0.3,format=yuv420p" -c:v libx264 -pix_fmt yuv420p -preset medium -b:v 2M -minrate 1500k -maxrate 3M -bufsize 6M -movflags +faststart -an "${final}"`,
    { stdio: 'pipe' },
  );

  // Generate a poster GIF (first frame) for the video poster attribute
  const gif = path.join(OUT, `${demo.name}.gif`);
  execSync(
    `ffmpeg -y -i "${final}" -vf "fps=15,scale=600:-1:flags=lanczos" -loop 0 "${gif}"`,
    { stdio: 'pipe' },
  );

  const sizeMb = (fs.statSync(final).size / 1024 / 1024).toFixed(2);
  console.log(`  ✓ ${path.basename(final)} (${sizeMb} MB, ${cumulativeDur.toFixed(1)}s)`);
}

(async () => {
  console.log('\n📼 Building landing-page demo loops\n');
  const backdrop = await makeBackdrop();
  for (const demo of DEMOS) {
    await buildDemo(demo, backdrop);
  }
  console.log(`\n✓ All 4 demos written to ${OUT}\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
