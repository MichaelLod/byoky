/**
 * Batman-style remix of the Product Hunt video.
 *
 *   Input:  marketing/voiceover/producthunt/*.wav  (from make-producthunt.ts)
 *           marketing/composites/*.png              (from compose.ts)
 *   Output: marketing/videos/product-hunt-batman.mp4 (+ square + vertical)
 *
 * Per-beat onomatopoeia + custom impact SFX (ffmpeg-synthesized so no
 * external assets or licensing): each beat has a distinct sound that
 * matches its word — a kick for BANG, a slam for SLAM, a chime for BYE.
 */
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import sharp from 'sharp';

const ROOT = path.resolve(__dirname, '../..');
const COMPOSITES = path.join(ROOT, 'marketing/composites');
const PH_VOICE = path.join(ROOT, 'marketing/voiceover/producthunt');
const OUT = path.join(ROOT, 'marketing/videos');
const TMP = path.join(ROOT, 'marketing/.cache/producthunt-batman');
const BURSTS = path.join(TMP, 'bursts');
const SFX = path.join(TMP, 'sfx');
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(BURSTS, { recursive: true });
fs.mkdirSync(SFX, { recursive: true });

const VIDEO_W = 1920;
const VIDEO_H = 1080;
const FPS = 30;

// PH beats (same IDs as make-producthunt.ts)
const PH_BEATS = ['ph01-hero', 'ph02-control', 'ph03-bills', 'ph04-gifts', 'ph05-cta', 'ph06-bye'];

interface BeatStyle {
  onomatopoeia: string;
  burstFill: string;
  burstText: string;
  flashColor: string;
  rotate: number;
  frameCandidates: string[];
  /** ffmpeg command to synthesize this beat's impact SFX (writes to $OUT) */
  sfxSynth: (outFile: string) => string;
}

// Each beat's onomatopoeia word dictates its SFX character.
const BEAT_STYLES: Record<string, BeatStyle> = {
  'ph01-hero': {
    onomatopoeia: 'BANG!',
    burstFill: '#fde047',
    burstText: '#141418',
    flashColor: '#fde047',
    rotate: -6,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-02-1280x800.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
    // BANG = classic kick (60Hz sub-bass) + high-freq noise transient
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=60:duration=0.28:sample_rate=48000"',
      '-f lavfi -i "anoisesrc=d=0.1:c=white:r=48000:a=0.9"',
      '-filter_complex "' +
        [
          `[0:a]volume=1.0,afade=t=out:st=0.02:d=0.24[bass]`,
          `[1:a]highpass=f=1200,lowpass=f=6000,afade=t=out:st=0:d=0.08,volume=0.55[click]`,
          `[bass][click]amix=inputs=2:duration=first:normalize=0,volume=1.15[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
  'ph02-control': {
    onomatopoeia: 'SLAM!',
    burstFill: '#f43f5e',
    burstText: '#fff',
    flashColor: '#f43f5e',
    rotate: 5,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-05-1280x800.png'),
      path.join(COMPOSITES, 'chrome-store-04-1280x800.png'),
    ],
    // SLAM = thud (40Hz) + metallic hit (white noise high-passed)
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=45:duration=0.35:sample_rate=48000"',
      '-f lavfi -i "anoisesrc=d=0.2:c=white:r=48000:a=0.85"',
      '-filter_complex "' +
        [
          `[0:a]volume=1.1,afade=t=out:st=0.02:d=0.3[thud]`,
          `[1:a]highpass=f=3000,afade=t=out:st=0.02:d=0.15,volume=0.5[metal]`,
          `[thud][metal]amix=inputs=2:duration=first:normalize=0,volume=1.1[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
  'ph03-bills': {
    onomatopoeia: 'YES!',
    burstFill: '#22c55e',
    burstText: '#fff',
    flashColor: '#22c55e',
    rotate: -8,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-06-1280x800.png'),
      path.join(COMPOSITES, 'chrome-store-04-1280x800.png'),
    ],
    // YES = bass boom + bright major-chord sparkle (C E G = 523/659/784 Hz)
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=55:duration=0.3:sample_rate=48000"',
      '-f lavfi -i "sine=frequency=523.25:duration=0.35:sample_rate=48000"',
      '-f lavfi -i "sine=frequency=659.25:duration=0.35:sample_rate=48000"',
      '-f lavfi -i "sine=frequency=783.99:duration=0.35:sample_rate=48000"',
      '-filter_complex "' +
        [
          `[0:a]volume=0.9,afade=t=out:st=0.02:d=0.26[boom]`,
          `[1:a]volume=0.25,afade=t=in:st=0.02:d=0.06,afade=t=out:st=0.15:d=0.2[n1]`,
          `[2:a]volume=0.25,afade=t=in:st=0.04:d=0.06,afade=t=out:st=0.15:d=0.2[n2]`,
          `[3:a]volume=0.25,afade=t=in:st=0.06:d=0.06,afade=t=out:st=0.15:d=0.2[n3]`,
          `[n1][n2][n3]amix=inputs=3:duration=first:normalize=0[chord]`,
          `[boom][chord]amix=inputs=2:duration=first:normalize=0,volume=1.05[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
  'ph04-gifts': {
    onomatopoeia: 'POW!',
    burstFill: '#a855f7',
    burstText: '#fff',
    flashColor: '#a855f7',
    rotate: 10,
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-03-1280x800.png'),
    ],
    // POW = punchy kick + snare-like snap
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=70:duration=0.22:sample_rate=48000"',
      '-f lavfi -i "anoisesrc=d=0.12:c=pink:r=48000:a=0.9"',
      '-filter_complex "' +
        [
          `[0:a]volume=1.0,afade=t=out:st=0.02:d=0.18[kick]`,
          `[1:a]bandpass=f=2000:w=1500,afade=t=out:st=0.02:d=0.1,volume=0.55[snap]`,
          `[kick][snap]amix=inputs=2:duration=first:normalize=0,volume=1.15[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
  'ph05-cta': {
    onomatopoeia: 'KAPOW!',
    burstFill: '#0ea5e9',
    burstText: '#fff',
    flashColor: '#0ea5e9',
    rotate: -4,
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-cover-1270x760.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
    // KAPOW = cinematic hit — sub-bass boom + cymbal crash + rising whoosh
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=50:duration=0.5:sample_rate=48000"',
      '-f lavfi -i "anoisesrc=d=0.5:c=white:r=48000:a=1"',
      '-f lavfi -i "anoisesrc=d=0.35:c=pink:r=48000:a=0.85"',
      '-filter_complex "' +
        [
          `[0:a]volume=1.1,afade=t=out:st=0.05:d=0.45[sub]`,
          `[1:a]highpass=f=5000,afade=t=in:st=0:d=0.02,afade=t=out:st=0.1:d=0.4,volume=0.45[crash]`,
          `[2:a]highpass=f=800,lowpass=f=4000,afade=t=out:st=0.1:d=0.25,volume=0.5[mid]`,
          `[sub][crash][mid]amix=inputs=3:duration=first:normalize=0,volume=1.1[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
  'ph06-bye': {
    onomatopoeia: 'BYE!',
    burstFill: '#7dd3fc',
    burstText: '#141418',
    flashColor: '#7dd3fc',
    rotate: 3,
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-header-1200x630.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
    // BYE = friendly two-note ding (E6 → A6, up 5th) — warm closer
    sfxSynth: (out) => [
      'ffmpeg -y',
      '-f lavfi -i "sine=frequency=1318.51:duration=0.25:sample_rate=48000"',
      '-f lavfi -i "sine=frequency=1760:duration=0.4:sample_rate=48000"',
      '-filter_complex "' +
        [
          `[0:a]volume=0.6,afade=t=in:st=0:d=0.01,afade=t=out:st=0.05:d=0.2[e6]`,
          `[1:a]volume=0.55,afade=t=in:st=0.1:d=0.01,afade=t=out:st=0.15:d=0.25[a6]`,
          `[e6][a6]amix=inputs=2:duration=first:normalize=0,volume=1.1[out]`,
        ].join(';') +
        '"',
      '-map "[out]"', out,
    ].join(' '),
  },
};

// ── Starburst SVG generator (same as make-batman.ts) ────────────────────
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
  const textMaxW = innerR * 1.6;
  const fontSize = Math.min(opts.size * 0.22, (textMaxW / Math.max(opts.text.length, 4)) * 2.0);
  return `
<svg width="${opts.size}" height="${opts.size}" viewBox="0 0 ${opts.size} ${opts.size}" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(${opts.rotate} ${cx} ${cy})">
    <polygon points="${polygon}" fill="#141418" transform="translate(8 10)"/>
    <polygon points="${polygon}" fill="${opts.fill}" stroke="#141418" stroke-width="10" stroke-linejoin="miter"/>
    <polygon points="${polygon}" fill="none" stroke="#ffffff" stroke-width="3" stroke-opacity="0.5" transform="scale(0.78) translate(${cx * 0.28} ${cy * 0.28})"/>
    <text x="${cx}" y="${cy + fontSize * 0.35}"
      text-anchor="middle"
      font-family="Impact, 'Arial Black', 'Helvetica Neue', sans-serif"
      font-size="${fontSize.toFixed(0)}" font-weight="900"
      fill="${opts.textColor}" stroke="#141418" stroke-width="4" paint-order="stroke"
      letter-spacing="-2">${opts.text}</text>
  </g>
</svg>`;
}

async function generateBursts(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, style] of Object.entries(BEAT_STYLES)) {
    const svg = starburstSvg({
      size: 900, points: 16, innerRatio: 0.72,
      fill: style.burstFill, text: style.onomatopoeia,
      textColor: style.burstText, rotate: style.rotate,
    });
    const file = path.join(BURSTS, `${id}.png`);
    await sharp(Buffer.from(svg)).png().toFile(file);
    out[id] = file;
    console.log(`  🎨 burst ${id}: ${style.onomatopoeia}`);
  }
  return out;
}

function generateSfx(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, style] of Object.entries(BEAT_STYLES)) {
    const file = path.join(SFX, `${id}.wav`);
    execSync(style.sfxSynth(file), { stdio: 'pipe' });
    out[id] = file;
    console.log(`  🔊 sfx ${id}: ${style.onomatopoeia}`);
  }
  return out;
}

function probeDims(p: string): { width: number; height: number } {
  const o = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${p}"`,
    { encoding: 'utf-8' },
  ).trim();
  const [w, h] = o.split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

function probeDuration(p: string): number {
  const o = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${p}"`,
    { encoding: 'utf-8' },
  ).trim();
  return parseFloat(o);
}

function pickFrame(style: BeatStyle): string {
  for (const c of style.frameCandidates) if (fs.existsSync(c)) return c;
  throw new Error('No composite available');
}

function buildBeatFilter(imgPath: string, dur: number): string {
  const { width, height } = probeDims(imgPath);
  const aspect = width / height;
  const isLandscape = Math.abs(aspect - VIDEO_W / VIDEO_H) < 0.25;

  const CW = Math.round(VIDEO_W * 1.15);
  const CH = Math.round(VIDEO_H * 1.15);

  const bgChain = isLandscape
    ? `[0:v]scale=${CW}:${CH}:force_original_aspect_ratio=decrease,pad=${CW}:${CH}:(ow-iw)/2:(oh-ih)/2:color=#141418[content]`
    : [
        `[0:v]split=2[bg0][fg0]`,
        `[bg0]scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},boxblur=40:2,eq=brightness=-0.08[bg]`,
        `[fg0]scale=${CW}:${CH}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[content]`,
      ].join(';');

  const punch = 0.3;
  const peakZoom = isLandscape ? 1.25 : 1.12;
  const zoomDelta = peakZoom - 1.0;
  const zoomExpr = `if(lt(t,${punch}),${peakZoom}-${zoomDelta.toFixed(3)}*(t/${punch}),1.0+0.02*(t-${punch})/${(dur - punch).toFixed(2)})`;

  const shakeDur = 0.45;
  const shakeAmp = 18;
  const shakeFade = `max(0,1-t/${shakeDur})`;
  const shakeX = `(${CW}-${VIDEO_W})/2 + ${shakeAmp}*sin(t*55)*${shakeFade}`;
  const shakeY = `(${CH}-${VIDEO_H})/2 + ${shakeAmp}*cos(t*48)*${shakeFade}`;

  const zoomChain =
    `[content]scale=w='${CW}*${zoomExpr}':h='${CH}*${zoomExpr}':flags=lanczos:eval=frame,` +
    `crop=${VIDEO_W}:${VIDEO_H}:x='${shakeX}':y='${shakeY}':exact=1,fps=${FPS}[zoomed]`;

  const burstIn = 0.2;
  const burstBounceMid = burstIn + 0.175;
  const burstBounceEnd = burstIn + 0.35;
  const burstHoldEnd = Math.min(1.8, dur - 0.4);
  const burstScale = `if(lt(t,${burstIn}),0.01,if(lt(t,${burstBounceMid}),0.5+0.6*(t-${burstIn})/0.175,if(lt(t,${burstBounceEnd}),1.1-0.1*(t-${burstBounceMid})/0.175,1)))`;
  const burstSize = 540;
  const burstOffsetX = `(W-w)/2 + 10*sin(t*8)`;
  const burstOffsetY = `(H-h)/2 + 10*cos(t*7)`;

  const burstChain = [
    `[1:v]format=rgba,scale=w='${burstSize}*${burstScale}':h='${burstSize}*${burstScale}':flags=lanczos:eval=frame,fade=t=in:st=${burstIn}:d=0.12:alpha=1,fade=t=out:st=${burstHoldEnd.toFixed(2)}:d=0.35:alpha=1[burst]`,
    `[zoomed][burst]overlay=x='${burstOffsetX}':y='${burstOffsetY}':eof_action=pass[bursted]`,
  ].join(';');

  return [bgChain, zoomChain, burstChain, `[bursted]drawbox=x=0:y=ih-40:w=iw*0.35:h=6:color=#0ea5e9:t=fill,drawbox=x=iw*0.65:y=ih-40:w=iw*0.35:h=6:color=#0ea5e9:t=fill,format=yuv420p[out]`].join(';');
}

async function makeFlashClip(color: string, outFile: string): Promise<void> {
  execSync(
    `ffmpeg -y -f lavfi -i "color=${color}:size=${VIDEO_W}x${VIDEO_H}:duration=0.1:rate=${FPS}" -vf "fade=t=out:st=0.06:d=0.04" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -r ${FPS} "${outFile}"`,
    { stdio: 'pipe' },
  );
}

(async () => {
  console.log('\n🦇 Batman × Product Hunt\n');

  console.log('Generating bursts...');
  const bursts = await generateBursts();

  console.log('\nSynthesizing impact SFX...');
  const sfx = generateSfx();

  // Collect per-segment durations from the existing PH narration WAVs
  const durations: Record<string, number> = {};
  for (const id of PH_BEATS) {
    durations[id] = probeDuration(path.join(PH_VOICE, `${id}.wav`));
  }

  console.log('\nRendering beats...');
  const beatClips: string[] = [];
  const flashClips: string[] = [];
  const beatStarts: number[] = [];
  let cursor = 0;

  for (let i = 0; i < PH_BEATS.length; i++) {
    const id = PH_BEATS[i];
    const style = BEAT_STYLES[id];
    const img = pickFrame(style);
    const dur = durations[id] + 0.3;

    beatStarts.push(cursor);

    const filter = buildBeatFilter(img, dur);
    const clipOut = path.join(TMP, `beat-${id}.mp4`);
    const r = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loop', '1', '-i', img,
        '-loop', '1', '-i', bursts[id],
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
      throw new Error(`ffmpeg failed on ${id}`);
    }
    beatClips.push(clipOut);
    console.log(`  ✓ ${id} [${style.onomatopoeia}] (${dur.toFixed(2)}s)`);

    cursor += dur;
    if (i < PH_BEATS.length - 1) {
      const flash = path.join(TMP, `flash-${id}.mp4`);
      await makeFlashClip(style.flashColor, flash);
      flashClips.push(flash);
      cursor += 0.1; // flash duration
    }
  }

  const interleaved: string[] = [];
  for (let i = 0; i < beatClips.length; i++) {
    interleaved.push(beatClips[i]);
    if (i < flashClips.length) interleaved.push(flashClips[i]);
  }

  const listFile = path.join(TMP, 'concat.txt');
  fs.writeFileSync(listFile, interleaved.map((v) => `file '${v}'`).join('\n'));
  const silentMp4 = path.join(TMP, 'silent.mp4');
  console.log('\nConcatenating...');
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -preset medium -crf 20 -r ${FPS} "${silentMp4}"`,
    { stdio: 'pipe' },
  );

  // Build final audio: voice (per-beat, delayed) + unique SFX per beat at beat start
  console.log('Building final audio...');
  const voiceSegs = PH_BEATS.map((id) => path.join(PH_VOICE, `${id}.wav`));
  const voiceInputs = voiceSegs.map((f) => `-i "${f}"`).join(' ');
  const sfxInputs = PH_BEATS.map((id) => `-i "${sfx[id]}"`).join(' ');
  const voiceCount = voiceSegs.length;

  const mixParts: string[] = [];
  PH_BEATS.forEach((_, i) => {
    const delayMs = Math.round((beatStarts[i] + 0.2) * 1000); // voice kicks in shortly after beat start
    mixParts.push(`[${i}:a]adelay=${delayMs}|${delayMs},volume=+2dB[v${i}]`);
  });
  PH_BEATS.forEach((_, i) => {
    const delayMs = Math.round(beatStarts[i] * 1000);
    mixParts.push(`[${voiceCount + i}:a]adelay=${delayMs}|${delayMs},volume=+0dB[s${i}]`);
  });
  const stems = [
    ...PH_BEATS.map((_, i) => `[v${i}]`),
    ...PH_BEATS.map((_, i) => `[s${i}]`),
  ].join('');
  mixParts.push(
    `${stems}amix=inputs=${voiceCount * 2}:duration=longest:dropout_transition=0:normalize=0,volume=1.1[finalAudio]`,
  );

  const finalAudio = path.join(TMP, 'final-audio.wav');
  execSync(
    `ffmpeg -y ${voiceInputs} ${sfxInputs} -filter_complex "${mixParts.join(';')}" -map "[finalAudio]" "${finalAudio}"`,
    { stdio: 'pipe' },
  );

  const finalMp4 = path.join(OUT, 'product-hunt-batman.mp4');
  console.log('Muxing...');
  execSync(
    `ffmpeg -y -i "${silentMp4}" -i "${finalAudio}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`,
    { stdio: 'pipe' },
  );

  const squareMp4 = path.join(OUT, 'product-hunt-batman-square-1080.mp4');
  execSync(
    `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=40:2,eq=brightness=-0.1[bg];` +
      `[fg]scale=1080:-1:flags=lanczos[fg];` +
      `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
      ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${squareMp4}"`,
    { stdio: 'pipe' },
  );

  const verticalMp4 = path.join(OUT, 'product-hunt-batman-vertical-1080x1920.mp4');
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
  console.log('🦇 BANG! SLAM! KAPOW! BYE! 🦇\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
