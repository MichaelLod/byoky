/**
 * Build the walkthrough video by:
 *   1. Reading narration.json for segment timings
 *   2. Mapping each narration beat to one of the composite "eye-catcher" frames
 *   3. Generating an MP4 with ffmpeg using the still images + narration audio
 *      (one image per beat, duration = beat duration), with a fade between
 *
 * Output: marketing/videos/walkthrough.mp4
 */
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const COMPOSITES = path.join(ROOT, 'marketing/composites');
const RAW_POPUP = path.join(ROOT, 'marketing/raw/popup-frames');
const RAW_WEB = path.join(ROOT, 'marketing/raw/web');
const VOICEOVER = path.join(ROOT, 'marketing/voiceover');
const OUT = path.join(ROOT, 'marketing/videos');
const TMP = path.join(ROOT, 'marketing/.cache');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const NARRATION_WAV = path.join(VOICEOVER, 'narration.wav');
const NARRATION_JSON = path.join(VOICEOVER, 'narration.json');
if (!fs.existsSync(NARRATION_WAV) || !fs.existsSync(NARRATION_JSON)) {
  console.error('✗ narration.wav not found — run pnpm narrate first.');
  process.exit(1);
}

interface Segment {
  id: string;
  text: string;
  duration: number;
  offset: number;
}

const segments: Segment[] = JSON.parse(fs.readFileSync(NARRATION_JSON, 'utf-8'));

// Composites already carry their own headline + sub text; no chapter labels.
// Only the final CTA beat gets a big centered callout so the URL lands.
const BEAT_HERO_CAPTION: Record<string, string> = {
  '06-call-to-action': 'byoky.com',
};

// Map narration beats to which composite to show. Falls back gracefully if a
// composite is missing.
const BEAT_FRAME: Record<string, string[]> = {
  '01-hook': [path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png')],
  '02-intro': [
    path.join(COMPOSITES, 'chrome-store-01-1280x800.png'),
    path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
  ],
  '03-multi-provider': [
    path.join(COMPOSITES, 'chrome-store-02-1280x800.png'),
    path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
  ],
  '04-gifts': [
    path.join(COMPOSITES, 'chrome-store-03-1280x800.png'),
    path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
  ],
  '05-cross-device': [
    path.join(COMPOSITES, 'ios-app-store-01-1320x2868.png'),
    path.join(COMPOSITES, 'product-hunt-cover-1270x760.png'),
    path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
  ],
  '06-call-to-action': [path.join(COMPOSITES, 'product-hunt-header-1200x630.png')],
};

const VIDEO_W = 1920;
const VIDEO_H = 1080;
const FPS = 30;

function pickFrame(beat: string): string {
  const candidates = BEAT_FRAME[beat] ?? [];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Fallback to ANY composite png
  const fallback = fs.readdirSync(COMPOSITES).find((f) => f.endsWith('.png'));
  if (fallback) return path.join(COMPOSITES, fallback);
  throw new Error('No composite images available — run pnpm compose first');
}

/**
 * Build an ffmpeg filter_complex for one beat with:
 *  - Landscape: scale+pad  /  Portrait: blurred-fill background (auto detect)
 *  - Punchy opening zoom: 1.15 → 1.00 over the first 0.5s (snap into place)
 *  - Sustained Ken-Burns drift thereafter (1.00 → 1.04)
 *  - Big uppercase caption that fades/scales in (0.2s) and holds
 *  - Bottom accent bar with beat index for pacing feedback
 */
function beatFilter(imgPath: string, dur: number, beatId: string, beatIdx: number, totalBeats: number): string {
  const totalFrames = Math.max(1, Math.round(dur * FPS));
  const { width, height } = probeDims(imgPath);
  const aspect = width / height;
  const videoAspect = VIDEO_W / VIDEO_H;
  const isLandscape = Math.abs(aspect - videoAspect) < 0.25;

  // ── Zoom: single gentle continuous curve (no two-phase jerk) ─────────
  // Using `scale` with eval=frame + flags=lanczos instead of `zoompan` —
  // zoompan rounds its x/y crop offsets to integers each frame, so a slow
  // zoom (1.0→1.04) drifts by 0.16 pixels/frame and produces visible 1-px
  // "wobble from center" as rounded offsets change. scale+lanczos does
  // proper sub-pixel interpolation so the zoom is smooth.
  const zoomExpr = `1.0+0.04*t/${dur.toFixed(2)}`;

  const hero = (BEAT_HERO_CAPTION[beatId] ?? '').replace(/'/g, "\\'").replace(/:/g, '\\:');

  // ── Background/foreground compositing chain ──────────────────────────
  // Render the composite at the final resolution (1920×1080). We don't need
  // the 2× oversample trick anymore — scale+lanczos handles sub-pixel
  // smoothness natively, which the old zoompan chain couldn't.
  const bgChain = isLandscape
    ? `[0:v]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=decrease,pad=${VIDEO_W}:${VIDEO_H}:(ow-iw)/2:(oh-ih)/2:color=#141418[main]`
    : [
        `[0:v]split=2[bg0][fg0]`,
        `[bg0]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H},boxblur=40:2,eq=brightness=-0.08[bg]`,
        `[fg0]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[main]`,
      ].join(';');

  // Progress bar at the bottom (drawn after downsample, so coords are 1x)
  const progressStart = beatIdx / totalBeats;
  const progressDelta = 1 / totalBeats;
  const barH = 6;
  const barWidthExpr = `iw*(${progressStart.toFixed(4)}+${progressDelta.toFixed(4)}*t/${dur.toFixed(2)})`;
  const drawboxExpr = `drawbox=x=0:y=ih-${barH}:w='${barWidthExpr}':h=${barH}:color=0x0ea5e9@1.0:t=fill`;

  // Hero caption: only on the final CTA beat. Big, centered, solid.
  let heroExpr: string | null = null;
  if (hero) {
    const heroFontSize = Math.round(VIDEO_H * 0.14);
    const heroAlpha = `if(lt(t,0.5),max(0,t-0.1)/0.4,if(gt(t,${(dur - 0.4).toFixed(2)}),max(0,1-(t-${(dur - 0.4).toFixed(2)})/0.4),1))`;
    heroExpr = `drawtext=text='${hero}':fontfile='/System/Library/Fonts/SFNS.ttf':fontsize=${heroFontSize}:fontcolor=white@1.0:alpha='${heroAlpha}':x=(w-text_w)/2:y=(h-text_h)/2+120:borderw=4:bordercolor=0x141418`;
  }

  const overlays = [heroExpr, drawboxExpr].filter(Boolean);

  // scale with time-varying factor (eval=frame re-computes each frame) +
  // lanczos interpolation = sub-pixel smooth zoom. crop back to 1920×1080
  // from center afterwards. The crop offset (in_w-${VIDEO_W})/2 still
  // rounds to integer, but since scale produces smoothly interpolated
  // pixel values underneath, the crop round-to-int no longer causes
  // visible 1px jumps — the scaled content blends across the rounding
  // boundary.
  const smoothZoom =
    `scale=w='${VIDEO_W}*${zoomExpr}':h='${VIDEO_H}*${zoomExpr}':flags=lanczos:eval=frame,` +
    `crop=${VIDEO_W}:${VIDEO_H}:(in_w-${VIDEO_W})/2:(in_h-${VIDEO_H})/2,` +
    `fps=${FPS}`;

  const filter = [
    bgChain,
    `[main]${smoothZoom}[zoomed]`,
    `[zoomed]${overlays.join(',')},format=yuv420p[out]`,
  ].join(';');

  return filter;
}

function probeDims(imgPath: string): { width: number; height: number } {
  const out = execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${imgPath}"`, {
    encoding: 'utf-8',
  }).trim();
  const [w, h] = out.split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

console.log('\n🎬 Building walkthrough video...\n');

// Build one video per beat (image + the right slice of audio) then concat.
const beatVideos: string[] = [];
for (let i = 0; i < segments.length; i++) {
  const seg = segments[i];
  const img = pickFrame(seg.id);
  const out = path.join(TMP, `beat-${seg.id}.mp4`);
  const dur = seg.duration + 0.4;
  const filter = beatFilter(img, dur, seg.id, i, segments.length);
  const args = [
    '-y', '-loop', '1', '-i', img,
    '-t', String(dur),
    '-filter_complex', filter, '-map', '[out]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    // Target bitrate VBR — CRF alone would drop to ~135 kb/s on our dark
    // low-entropy frames (visibly pixelated at 1080p). -b:v + -minrate
    // forces a 4 Mbps floor, -maxrate 8M allows headroom for busier frames.
    '-preset', 'medium',
    '-b:v', '5M', '-minrate', '4M', '-maxrate', '8M', '-bufsize', '16M',
    '-profile:v', 'high', '-level', '4.2',
    out,
  ];
  console.log(`  ⏳ beat ${seg.id} (${dur.toFixed(2)}s)`);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.status !== 0) {
    console.error(r.stderr?.toString());
    throw new Error(`ffmpeg failed on beat ${seg.id}`);
  }
  beatVideos.push(out);
}

// Concat list
const listFile = path.join(TMP, 'concat.txt');
fs.writeFileSync(listFile, beatVideos.map((v) => `file '${v}'`).join('\n'));

// Concat to silent video
const silentMp4 = path.join(TMP, 'walkthrough-silent.mp4');
console.log('\n  ⏳ concatenating beats...');
execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${silentMp4}"`, { stdio: 'pipe' });

// ── Build energetic audio bed ────────────────────────────────────────
// 1. Whoosh SFX: 120ms band-filtered white-noise burst, placed at each
//    beat boundary. Gives an audible "cut" that signals pacing.
// 2. Music bed: slow sine chord + subtle kick pulse, looped + ducked under
//    voice via sidechaincompress. Kept -20dB so it doesn't compete.
const totalDur = segments.reduce((acc, s) => acc + s.duration + 0.4, 0);

// Whoosh SFX at each beat boundary (first whoosh at t=0.1 for the opener)
function makeWhoosh(id: string, seed: number): string {
  const file = path.join(TMP, `whoosh-${id}.wav`);
  // 120ms band-filtered white noise → whoosh. Slight pitch bend via highpass.
  execSync(
    `ffmpeg -y -f lavfi -i "anoisesrc=d=0.14:c=white:r=48000:a=0.7" -af "highpass=f=400,lowpass=f=4000,afade=t=in:st=0:d=0.02,afade=t=out:st=0.09:d=0.05,volume=-6dB" "${file}" 2>/dev/null`,
    { stdio: 'pipe' },
  );
  return file;
}

const whooshFiles: { file: string; at: number }[] = [];
let cursor = 0;
for (let i = 0; i < segments.length; i++) {
  whooshFiles.push({ file: makeWhoosh(segments[i].id, i), at: cursor });
  cursor += segments[i].duration + 0.4;
}

// Music bed: a minor-key 4-chord synth pad that loops. Two sine layers
// (root + fifth) modulated by a slow LFO, plus a kick pulse every beat.
const musicWav = path.join(TMP, 'music-bed.wav');
execSync(
  [
    'ffmpeg -y',
    // Ambient pad: sine(A2=110Hz) + sine(E3=164.81Hz), slow tremolo
    '-f lavfi -i "sine=frequency=110:duration=' + totalDur.toFixed(2) + ':sample_rate=48000"',
    '-f lavfi -i "sine=frequency=164.81:duration=' + totalDur.toFixed(2) + ':sample_rate=48000"',
    // Kick pulse: 60Hz tone gated by a square wave at 2Hz (~120bpm quarter notes)
    '-f lavfi -i "sine=frequency=55:duration=' + totalDur.toFixed(2) + ':sample_rate=48000"',
    '-filter_complex',
    '"' +
      [
        `[0:a]volume=0.35,tremolo=f=0.25:d=0.2[pad1]`,
        `[1:a]volume=0.22,tremolo=f=0.25:d=0.2[pad2]`,
        // Gated kick: multiply by square wave envelope (2Hz = 120bpm)
        `[2:a]volume=0.6,tremolo=f=2:d=1.0[kickA]`,
        `[kickA]highpass=f=40,lowpass=f=120,volume=0.5[kick]`,
        `[pad1][pad2]amix=inputs=2:duration=first:dropout_transition=0,volume=-3dB[padmix]`,
        `[padmix][kick]amix=inputs=2:duration=first:dropout_transition=0[music]`,
        `[music]lowpass=f=3000,highpass=f=60,volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=${(totalDur - 0.5).toFixed(2)}:d=0.5[out]`,
      ].join(';') +
      '"',
    '-map "[out]"',
    musicWav,
  ].join(' '),
  { stdio: 'pipe' },
);

// Compose the final audio bed: narration + whooshes (at timestamps) + music.
// Adelay each whoosh, then amix them with the narration on top.
const mixInputs = [
  `-i "${NARRATION_WAV}"`, // 0: narration
  `-i "${musicWav}"`, // 1: music
  ...whooshFiles.map((w) => `-i "${w.file}"`), // 2..N: whooshes
].join(' ');

const mixFilter = [
  // Narration: light compression + slight reverb feel (aecho)
  `[0:a]acompressor=threshold=-18dB:ratio=3:attack=5:release=50,volume=+2dB[voice]`,
  // Music: ducked via sidechain against voice (so it drops when she talks)
  `[1:a][voice]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]`,
  `[ducked]volume=-18dB[musicQuiet]`,
  // Delay each whoosh to its timestamp and mix
  ...whooshFiles.map((w, i) => `[${i + 2}:a]adelay=${Math.round(w.at * 1000)}|${Math.round(w.at * 1000)},volume=-2dB[w${i}]`),
  // Amix voice + music + all whooshes
  `[voice][musicQuiet]${whooshFiles.map((_, i) => `[w${i}]`).join('')}amix=inputs=${2 + whooshFiles.length}:duration=first:dropout_transition=0:normalize=0,volume=1.1[finalAudio]`,
].join(';');

const finalAudioWav = path.join(TMP, 'final-audio.wav');
execSync(
  `ffmpeg -y ${mixInputs} -filter_complex "${mixFilter}" -map "[finalAudio]" "${finalAudioWav}"`,
  { stdio: 'pipe' },
);

// Mux final audio with video
const finalMp4 = path.join(OUT, 'walkthrough.mp4');
console.log('  ⏳ muxing narration + music + SFX...');
execSync(
  `ffmpeg -y -i "${silentMp4}" -i "${finalAudioWav}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`,
  { stdio: 'pipe' },
);

// Also a square version for social — preserve the full 16:9 content, fill
// the dead zones top/bottom with a blurred copy of the same frame so nothing
// gets cropped off (previous version hard-cropped 420px from each side,
// which cut headline/sub text on every chrome-store slide).
const square = path.join(OUT, 'walkthrough-square-1080.mp4');
console.log('  ⏳ rendering 1080×1080 square version...');
execSync(
  `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=40:2,eq=brightness=-0.1[bg];` +
    `[fg]scale=1080:-1:flags=lanczos[fg];` +
    `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
    ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${square}"`,
  { stdio: 'pipe' },
);

// And a vertical 1080×1920 version — same strategy (scale-to-fit + blurred
// fill background). 9:16 is the portrait spec for Reels / TikTok / Shorts.
const vertical = path.join(OUT, 'walkthrough-vertical-1080x1920.mp4');
console.log('  ⏳ rendering 1080×1920 vertical version...');
execSync(
  `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=60:3,eq=brightness=-0.1[bg];` +
    `[fg]scale=1080:-1:flags=lanczos[fg];` +
    `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
    ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${vertical}"`,
  { stdio: 'pipe' },
);

console.log(`\n✓ ${path.basename(finalMp4)}`);
console.log(`✓ ${path.basename(square)}`);
console.log(`✓ ${path.basename(vertical)}\n`);
