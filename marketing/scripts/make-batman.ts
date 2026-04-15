/**
 * Build a Batman-TV-series-style remix of the walkthrough: comic-book
 * starburst overlays ("POW!", "BAM!", "KAPOW!"), hard zoom punches, screen
 * shake on impacts, quick color-flash frames between beats, loud whooshes.
 *
 * Reuses the existing walkthrough narration.wav so we don't re-spend Gemini
 * API calls. Only the visuals + audio bed are rebuilt.
 *
 *   Output: marketing/videos/walkthrough-batman.mp4
 *           marketing/videos/walkthrough-batman-square-1080.mp4
 *           marketing/videos/walkthrough-batman-vertical-1080x1920.mp4
 */
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '../..');
const COMPOSITES = path.join(ROOT, 'marketing/composites');
const RAW_POPUP = path.join(ROOT, 'marketing/raw/popup-frames');
const RAW_WEB = path.join(ROOT, 'marketing/raw/web');
const NARRATION_WAV = path.join(ROOT, 'marketing/voiceover/narration.wav');
const NARRATION_JSON = path.join(ROOT, 'marketing/voiceover/narration.json');
const OUT = path.join(ROOT, 'marketing/videos');
const TMP = path.join(ROOT, 'marketing/.cache/batman');
const BURSTS = path.join(TMP, 'bursts');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(BURSTS, { recursive: true });

if (!fs.existsSync(NARRATION_WAV) || !fs.existsSync(NARRATION_JSON)) {
  console.error('✗ Missing narration — run pnpm narrate first.');
  process.exit(1);
}

interface Segment {
  id: string;
  text: string;
  duration: number;
  offset: number;
}
const segments: Segment[] = JSON.parse(fs.readFileSync(NARRATION_JSON, 'utf-8'));

const VIDEO_W = 1920;
const VIDEO_H = 1080;
const FPS = 30;

// ── Per-beat config: onomatopoeia + colour + frame source ───────────────
interface BeatStyle {
  onomatopoeia: string;
  /** Star-burst fill (background of the comic sticker) */
  burstFill: string;
  /** Text colour on the burst */
  burstText: string;
  /** 2-frame flash colour between this beat and the next */
  flashColor: string;
  /** Rotation of burst (degrees) */
  rotate: number;
  /** Composite to show on this beat */
  frameCandidates: string[];
}

const BEAT_STYLES: Record<string, BeatStyle> = {
  '01-hook': {
    onomatopoeia: 'UGH!',
    burstFill: '#f43f5e',
    burstText: '#fff',
    flashColor: '#f43f5e',
    rotate: -8,
    frameCandidates: [path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png')],
  },
  '02-intro': {
    onomatopoeia: 'BAM!',
    burstFill: '#fde047',
    burstText: '#141418',
    flashColor: '#fde047',
    rotate: 6,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-01-1280x800.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
  },
  '03-multi-provider': {
    onomatopoeia: 'ZOOM!',
    burstFill: '#0ea5e9',
    burstText: '#fff',
    flashColor: '#0ea5e9',
    rotate: -5,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-02-1280x800.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
  },
  '04-gifts': {
    onomatopoeia: 'POW!',
    burstFill: '#22c55e',
    burstText: '#fff',
    flashColor: '#22c55e',
    rotate: 9,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-03-1280x800.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
  },
  '05-cross-device': {
    onomatopoeia: 'ZUSH!',
    burstFill: '#a855f7',
    burstText: '#fff',
    flashColor: '#a855f7',
    rotate: -12,
    // Landscape first — the 1.35× zoom-punch crops a portrait iPhone too
    // aggressively (top/bottom get sliced). The product-hunt-cover carries
    // an iPhone inside a landscape composition, so we still see the phone.
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-cover-1270x760.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
      path.join(COMPOSITES, 'ios-app-store-01-1320x2868.png'),
    ],
  },
  '06-call-to-action': {
    onomatopoeia: 'KAPOW!',
    burstFill: '#fde047',
    burstText: '#141418',
    flashColor: '#fde047',
    rotate: 4,
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-header-1200x630.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
  },
};

// ── Starburst SVG generator ─────────────────────────────────────────────
function starburstSvg(opts: {
  size: number;
  points: number;
  innerRatio: number;
  fill: string;
  text: string;
  textColor: string;
  rotate: number;
}): string {
  const cx = opts.size / 2;
  const cy = opts.size / 2;
  const outerR = opts.size * 0.48;
  const innerR = outerR * opts.innerRatio;
  const pts: string[] = [];
  const n = opts.points * 2;
  for (let i = 0; i < n; i++) {
    const angle = (i * Math.PI) / opts.points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const polygon = pts.join(' ');

  // Scale font to fit within inner circle, with margin
  const textMaxW = innerR * 1.6;
  const fontSize = Math.min(opts.size * 0.22, (textMaxW / Math.max(opts.text.length, 4)) * 2.0);

  // Bold comic-style text (Impact / Arial Black fallback). White stroke +
  // thick black outline reads well over any burst colour.
  return `
<svg width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(${opts.rotate} ${cx} ${cy})">
    <!-- outer dark shadow burst -->
    <polygon points="${polygon}" fill="#141418" transform="translate(8 10)"/>
    <!-- main coloured burst -->
    <polygon points="${polygon}" fill="${opts.fill}" stroke="#141418" stroke-width="10" stroke-linejoin="miter"/>
    <!-- inner highlight ring -->
    <polygon points="${polygon}" fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.5" transform="scale(0.78) translate(${cx * 0.28} ${cy * 0.28})"/>
    <!-- text -->
    <text x="${cx}" y="${cy + fontSize * 0.35}"
      text-anchor="middle"
      font-family="Impact, 'Arial Black', 'Helvetica Neue', sans-serif"
      font-size="${fontSize.toFixed(0)}"
      font-weight="900"
      fill="${opts.textColor}"
      stroke="#141418"
      stroke-width="4"
      paint-order="stroke"
      letter-spacing="-2">${opts.text}</text>
  </g>
</svg>`;
}

async function generateBursts(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, style] of Object.entries(BEAT_STYLES)) {
    const svg = starburstSvg({
      size: 900,
      points: 16,
      innerRatio: 0.72,
      fill: style.burstFill,
      text: style.onomatopoeia,
      textColor: style.burstText,
      rotate: style.rotate,
    });
    const file = path.join(BURSTS, `${id}.png`);
    await sharp(Buffer.from(svg)).png().toFile(file);
    out[id] = file;
    console.log(`  🎨 burst ${id}: ${style.onomatopoeia}`);
  }
  return out;
}

// ── Probe dims helper ───────────────────────────────────────────────────
function probeDims(p: string): { width: number; height: number } {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${p}"`,
    { encoding: 'utf-8' },
  ).trim();
  const [w, h] = out.split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

function pickFrame(style: BeatStyle): string {
  for (const c of style.frameCandidates) if (fs.existsSync(c)) return c;
  throw new Error('No composite available');
}

// ── Batman-style per-beat filter graph ──────────────────────────────────
function buildBeatFilter(
  imgPath: string,
  burstPng: string,
  dur: number,
  beatIdx: number,
): string {
  const { width, height } = probeDims(imgPath);
  const aspect = width / height;
  const videoAspect = VIDEO_W / VIDEO_H;
  const isLandscape = Math.abs(aspect - videoAspect) < 0.25;

  // Oversize the main frame so we have headroom for a screen shake (crop)
  // without black edges. 1.15x oversample → 12% of width on each side.
  const CW = Math.round(VIDEO_W * 1.15);
  const CH = Math.round(VIDEO_H * 1.15);

  // Background/foreground chain for the beat content, oversized.
  const bgChain = isLandscape
    ? `[0:v]scale=${CW}:${CH}:force_original_aspect_ratio=decrease,pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:color=#141418[content]`
    : [
        `[0:v]split=2[bg0][fg0]`,
        `[bg0]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},boxblur=40:2,eq=brightness=-0.08[bg]`,
        `[fg0]scale=${CW}:${CH}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[content]`,
      ].join(';');

  // Hard zoom-punch: peak zoom at t=0, snaps back to 1.00 by t=punch.
  // Landscape sources get a 1.25× peak (gives room for the burst + shake
  // without cutting composite edges); portrait sources get 1.12× (smaller
  // punch so the tall aspect doesn't slice at the top/bottom during peak).
  const punch = 0.3;
  const peakZoom = isLandscape ? 1.25 : 1.12;
  const zoomDelta = peakZoom - 1.0;
  const zoomExpr = `if(lt(t,${punch}),${peakZoom}-${zoomDelta.toFixed(3)}*(t/${punch}),1.0+0.02*(t-${punch})/${(dur - punch).toFixed(2)})`;

  // Screen shake: sin/cos wobble on the crop offset during the first 0.45s.
  // Amplitude fades out linearly.
  const shakeDur = 0.45;
  const shakeAmp = 18; // pixels
  const shakeFade = `max(0,1-t/${shakeDur})`;
  const shakeX = `(${CW}-${VIDEO_W})/2 + ${shakeAmp}*sin(t*55)*${shakeFade}`;
  const shakeY = `(${CH}-${VIDEO_H})/2 + ${shakeAmp}*cos(t*48)*${shakeFade}`;

  // Zoom + shake via scale(eval=frame) + crop(eval=frame). scale+lanczos
  // keeps sub-pixel smooth at the calm drift part.
  const zoomChain =
    `[content]scale=w='${CW}*${zoomExpr}':h='${CH}*${zoomExpr}':flags=lanczos:eval=frame,` +
    `crop=${VIDEO_W}:${VIDEO_H}:x='${shakeX}':y='${shakeY}':exact=1,` +
    `fps=${FPS}[zoomed]`;

  // Burst overlay: pops in at t=0.20s, scales up 0.5 → 1.1 → 1.0 (back-bounce)
  // over 0.35s, holds, then fades out.
  const burstIn = 0.2;
  const burstBounceMid = burstIn + 0.175;
  const burstBounceEnd = burstIn + 0.35;
  const burstHoldEnd = Math.min(1.8, dur - 0.4);
  // Bounce scale: 0.5 (at burstIn) → 1.1 (midpoint) → 1.0 (settle)
  const burstScale = `if(lt(t,${burstIn}),0.01,if(lt(t,${burstBounceMid}),0.5+0.6*(t-${burstIn})/0.175,if(lt(t,${burstBounceEnd}),1.1-0.1*(t-${burstBounceMid})/0.175,1)))`;
  const burstSize = 540;
  // Wiggle the burst around for that "shaking with excitement" look
  const burstOffsetX = `(W-w)/2 + 10*sin(t*8)`;
  const burstOffsetY = `(H-h)/2 + 10*cos(t*7)`;

  // Alpha in/out handled by fade filter (t='st + d'), which edits the
  // alpha channel when alpha=1 is set. No need for custom geq.
  const burstChain = [
    `[1:v]format=rgba,scale=w='${burstSize}*${burstScale}':h='${burstSize}*${burstScale}':flags=lanczos:eval=frame,fade=t=in:st=${burstIn}:d=0.12:alpha=1,fade=t=out:st=${burstHoldEnd.toFixed(2)}:d=0.35:alpha=1[burst]`,
    `[zoomed][burst]overlay=x='${burstOffsetX}':y='${burstOffsetY}':eof_action=pass[bursted]`,
  ].join(';');

  // Tiny coloured corner "comic panel" accent at the bottom-left for extra flavour
  const accentColor = BEAT_STYLES[Object.keys(BEAT_STYLES)[beatIdx]].burstFill;
  const accentExpr = `drawbox=x=0:y=ih-40:w=iw*0.35:h=6:color=${accentColor}:t=fill,drawbox=x=iw*0.65:y=ih-40:w=iw*0.35:h=6:color=${accentColor}:t=fill`;

  return [bgChain, zoomChain, burstChain, `[bursted]${accentExpr},format=yuv420p[out]`].join(';');
}

// ── Flash frames between beats ──────────────────────────────────────────
async function makeFlashClip(color: string, outFile: string): Promise<void> {
  // 3-frame (~0.1s) solid colour flash with quick fade-out
  const dur = 0.1;
  execSync(
    `ffmpeg -y -f lavfi -i "color=${color}:size=${VIDEO_W}x${VIDEO_H}:duration=${dur}:rate=${FPS}" -vf "fade=t=out:st=0.06:d=0.04" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -r ${FPS} "${outFile}"`,
    { stdio: 'pipe' },
  );
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🦇 Batman-TV-series walkthrough\n');

  console.log('Generating bursts...');
  const bursts = await generateBursts();

  console.log('\nRendering beats...');
  const beatClips: string[] = [];
  const flashClips: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const style = BEAT_STYLES[seg.id];
    const burstPng = bursts[seg.id];
    const img = pickFrame(style);
    const dur = seg.duration + 0.3;

    const filter = buildBeatFilter(img, burstPng, dur, i);
    const clipOut = path.join(TMP, `beat-${seg.id}.mp4`);
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loop', '1', '-i', img,
        '-loop', '1', '-i', burstPng,
        '-t', String(dur),
        '-filter_complex', filter,
        '-map', '[out]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-r', String(FPS),
        '-preset', 'medium', '-crf', '20',
        clipOut,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    if (r.status !== 0) {
      console.error(r.stderr?.toString());
      throw new Error(`ffmpeg failed on ${seg.id}`);
    }
    beatClips.push(clipOut);
    console.log(`  ✓ ${seg.id} [${style.onomatopoeia}] (${dur.toFixed(2)}s)`);

    // Flash between beats (after every beat except the last)
    if (i < segments.length - 1) {
      const flashFile = path.join(TMP, `flash-${seg.id}.mp4`);
      await makeFlashClip(style.flashColor, flashFile);
      flashClips.push(flashFile);
    }
  }

  // Interleave beats + flashes
  const interleaved: string[] = [];
  for (let i = 0; i < beatClips.length; i++) {
    interleaved.push(beatClips[i]);
    if (i < flashClips.length) interleaved.push(flashClips[i]);
  }

  // Concat
  const listFile = path.join(TMP, 'concat.txt');
  fs.writeFileSync(listFile, interleaved.map((v) => `file '${v}'`).join('\n'));
  const silentMp4 = path.join(TMP, 'silent.mp4');
  console.log('\nConcatenating...');
  // Re-encode on concat so flash clips play nice with main clips (different
  // filters → may have different timebase otherwise)
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -r ${FPS} "${silentMp4}"`,
    { stdio: 'pipe' },
  );

  // Build audio: louder impact whooshes + narration + minimal music
  const totalDur = beatClips.length * 0.1 * 0 + segments.reduce((a, s) => a + s.duration + 0.3, 0) + (segments.length - 1) * 0.1;

  // Impact SFX per beat: 180ms filtered burst + sub-bass hit
  console.log('Building impact SFX bed...');
  const impactWav = path.join(TMP, 'impact.wav');
  execSync(
    `ffmpeg -y ` +
      `-f lavfi -i "anoisesrc=d=0.18:c=white:r=48000:a=0.9" ` +
      `-f lavfi -i "sine=frequency=60:duration=0.18:sample_rate=48000" ` +
      `-filter_complex "[0:a]highpass=f=300,lowpass=f=5000,afade=t=in:st=0:d=0.01,afade=t=out:st=0.1:d=0.08,volume=0.6[noise];[1:a]volume=0.85,afade=t=out:st=0.08:d=0.1[sub];[noise][sub]amix=inputs=2:duration=first:dropout_transition=0,volume=1.2[out]" ` +
      `-map "[out]" "${impactWav}"`,
    { stdio: 'pipe' },
  );

  // Compute beat-start timestamps accounting for inter-beat 0.1s flashes
  const beatStarts: number[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    beatStarts.push(cursor);
    cursor += segments[i].duration + 0.3;
    if (i < segments.length - 1) cursor += 0.1;
  }

  // Narration needs to be delayed to match the new timeline (flashes shift
  // beats after the first). Build a per-beat-delayed narration stem by
  // splitting the existing narration.wav at segment boundaries.
  console.log('Re-aligning narration around flash cuts...');
  const narrationSegments: string[] = [];
  let voiceCursor = 0;
  for (const seg of segments) {
    const segFile = path.join(TMP, `voice-${seg.id}.wav`);
    execSync(
      `ffmpeg -y -ss ${voiceCursor.toFixed(3)} -t ${seg.duration.toFixed(3)} -i "${NARRATION_WAV}" -c copy "${segFile}"`,
      { stdio: 'pipe' },
    );
    narrationSegments.push(segFile);
    voiceCursor += seg.duration + 0.4; // narration.json has 400ms gaps baked in
  }

  // Build mix: voice segments at beatStarts + impact at beatStarts + quiet music
  const voiceInputs = narrationSegments.map((f) => `-i "${f}"`).join(' ');
  const impactInputs = beatStarts.map(() => `-i "${impactWav}"`).join(' ');
  const totalInputs = narrationSegments.length + beatStarts.length;

  // Filter: each voice adelayed to its beat start + 0.15s; each impact at beat start.
  const mixFilterParts: string[] = [];
  narrationSegments.forEach((_, i) => {
    const delayMs = Math.round((beatStarts[i] + 0.15) * 1000);
    mixFilterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs},volume=+2dB[v${i}]`);
  });
  beatStarts.forEach((t, i) => {
    const delayMs = Math.round(t * 1000);
    mixFilterParts.push(`[${narrationSegments.length + i}:a]adelay=${delayMs}|${delayMs},volume=+0dB[imp${i}]`);
  });
  const allStems = [
    ...narrationSegments.map((_, i) => `[v${i}]`),
    ...beatStarts.map((_, i) => `[imp${i}]`),
  ].join('');
  mixFilterParts.push(
    `${allStems}amix=inputs=${totalInputs}:duration=longest:dropout_transition=0:normalize=0,volume=1.1[finalAudio]`,
  );

  const finalAudio = path.join(TMP, 'final-audio.wav');
  execSync(
    `ffmpeg -y ${voiceInputs} ${impactInputs} -filter_complex "${mixFilterParts.join(';')}" -map "[finalAudio]" "${finalAudio}"`,
    { stdio: 'pipe' },
  );

  // Final mux
  const finalMp4 = path.join(OUT, 'walkthrough-batman.mp4');
  console.log('\nMuxing...');
  execSync(
    `ffmpeg -y -i "${silentMp4}" -i "${finalAudio}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`,
    { stdio: 'pipe' },
  );

  // Square + vertical (same scale-to-fit + blurred fill pattern)
  const squareMp4 = path.join(OUT, 'walkthrough-batman-square-1080.mp4');
  execSync(
    `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=40:2,eq=brightness=-0.1[bg];` +
      `[fg]scale=1080:-1:flags=lanczos[fg];` +
      `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
      ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${squareMp4}"`,
    { stdio: 'pipe' },
  );

  const verticalMp4 = path.join(OUT, 'walkthrough-batman-vertical-1080x1920.mp4');
  execSync(
    `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=60:3,eq=brightness=-0.1[bg];` +
      `[fg]scale=1080:-1:flags=lanczos[fg];` +
      `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
      ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${verticalMp4}"`,
    { stdio: 'pipe' },
  );

  const sizeMb = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(2);
  console.log(`\n✓ ${path.basename(finalMp4)} (${sizeMb} MB)`);
  console.log(`✓ ${path.basename(squareMp4)}`);
  console.log(`✓ ${path.basename(verticalMp4)}\n`);
  console.log('🦇 BANG! ZOOM! POW! 🦇\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
