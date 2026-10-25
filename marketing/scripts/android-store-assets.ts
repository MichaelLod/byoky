/**
 * Google Play listing graphics that aren't screenshots:
 *   - feature-graphic-1024x500.png  in the 1.1.1 "retro security" design
 *   - icon-512x512.png              packages/android/store-icon-512.png, verified
 *                                   (512×512, no alpha) and copied, not redrawn
 *
 * compose.ts calls buildPlayAssets() for the Play set. Run on its own:
 *   cd marketing && npx tsx scripts/android-store-assets.ts [--to-android] [--icon-from-svg]
 * writes into marketing/composites/1.1.1/play/. --to-android also replaces
 * packages/android/store-feature-graphic.png for the release flow.
 * --icon-from-svg re-renders packages/android/store-icon-512.png from
 * docs/brand/app-icon.svg first (only when the icon master changes).
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { C, Kit, MARKETING, ROOT, Rendered, brackets, glow, muninn, page, statusLine } from './store-kit';

const ANDROID_ICON = path.join(ROOT, 'packages/android/store-icon-512.png');
const ANDROID_FEATURE = path.join(ROOT, 'packages/android/store-feature-graphic.png');

function featureGraphic(): string {
  const W = 1024, H = 500;
  return page(W, H, 1, '', `
    <div class="layer dots"></div>
    ${glow(270, 260, 380, 0.34)}
    <div class="layer scan"></div>
    <div style="position:absolute; left:40px; top:44px">${muninn({ size: 420, look: 5 })}</div>
    <div style="position:absolute; left:500px; top:0; bottom:0; right:40px; display:flex; flex-direction:column; justify-content:center;">
      <div style="font-size:15px">${statusLine('Keys stay on your device')}</div>
      <div class="lockup" style="font-size:96px; margin-top:14px; letter-spacing:0.08em">BYOKY</div>
      <p class="sub" style="font-size:30px; margin-top:12px; color:${C.bone}">Wallet for your AI API keys</p>
    </div>
    ${brackets({ x: 20, y: 20, w: W - 40, h: H - 40 }, 0)}`);
}

async function iconFromSvg(kit: Kit): Promise<void> {
  const svg = path.join(ROOT, 'docs/brand/app-icon.svg');
  const html = page(512, 512, 1, '', `<img src="/${path.relative(ROOT, svg)}" style="display:block; width:512px; height:512px">`);
  const tmp = path.join(MARKETING, '.cache/compose/icon-512.png');
  await kit.render(tmp, 512, 512, html);
  fs.copyFileSync(tmp, ANDROID_ICON);
  kit.written.pop();
  console.log(`  re-rendered ${path.relative(ROOT, ANDROID_ICON)}`);
}

export async function buildPlayAssets(kit: Kit, outDir: string, opts: { toAndroid?: boolean } = {}): Promise<Rendered[]> {
  const out: Rendered[] = [];
  const feature = await kit.render(path.join(outDir, 'feature-graphic-1024x500.png'), 1024, 500, featureGraphic());
  out.push(feature);
  if (opts.toAndroid) {
    fs.copyFileSync(feature.file, ANDROID_FEATURE);
    console.log(`  copied to ${path.relative(ROOT, ANDROID_FEATURE)}`);
  }

  const meta = await sharp(ANDROID_ICON).metadata();
  if (meta.width !== 512 || meta.height !== 512 || meta.hasAlpha) {
    throw new Error(`${ANDROID_ICON}: ${meta.width}×${meta.height}${meta.hasAlpha ? ' with alpha' : ''}; Play wants 512×512`);
  }
  const icon = path.join(outDir, 'icon-512x512.png');
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(ANDROID_ICON, icon);
  console.log(`  ${path.relative(ROOT, icon)}  512×512 (copied from packages/android)`);
  out.push({ file: icon, width: 512, height: 512 });
  return out;
}

if (require.main === module) {
  (async () => {
    const kit = await Kit.open();
    try {
      if (process.argv.includes('--icon-from-svg')) await iconFromSvg(kit);
      await buildPlayAssets(kit, path.join(MARKETING, 'composites/1.1.1/play'), { toAndroid: process.argv.includes('--to-android') });
    } finally {
      await kit.close();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
