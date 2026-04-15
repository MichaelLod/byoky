/**
 * Build the Product Hunt launch video — SEPARATE from the main walkthrough.
 *
 *   Input:  marketing/composites/*.png  (already rendered)
 *   TTS:    marketing/voiceover/producthunt/*.wav  (regenerated each run)
 *   Output: marketing/videos/product-hunt.mp4  (+ square + vertical variants)
 *
 * Script (user-provided):
 *   1. One wallet, all your AI API keys
 *   2. Devs can connect and use them — as much as YOU allow
 *   3. No more crazy AI bills for devs
 *   4. (Gifts pitch — reused from the main walkthrough)
 *   5. byoky.com — let's connect and build
 *   6. Okay thanks bye
 *
 * Each TTS call is prefixed with a delivery instruction (confident / relieved /
 * conspiratorial / warm-casual) so Puck doesn't flatten into one tone.
 */
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const COMPOSITES = path.join(ROOT, 'marketing/composites');
const VOICEOVER_DIR = path.join(ROOT, 'marketing/voiceover/producthunt');
const OUT = path.join(ROOT, 'marketing/videos');
const TMP = path.join(ROOT, 'marketing/.cache/producthunt');
fs.mkdirSync(VOICEOVER_DIR, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const ENV_LOCAL = path.join(ROOT, '.env.local');
function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(ENV_LOCAL)) return out;
  for (const line of fs.readFileSync(ENV_LOCAL, 'utf-8').split('\n')) {
    const m = line.trim().match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...process.env, ...loadEnv() };
const API_KEY = env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('✗ GEMINI_API_KEY missing in .env.local');
  process.exit(1);
}

const VOICE = process.env.BYOKY_TTS_VOICE || 'Puck';
const MODEL = 'gemini-2.5-flash-preview-tts';

interface Segment {
  id: string;
  text: string;
  /** Which composite to show during this beat */
  frameCandidates: string[];
  /** Optional big centered hero caption (drawn over the zoomed frame) */
  hero?: string;
}

const SEGMENTS: Segment[] = [
  {
    id: 'ph01-hero',
    text: 'Say with bright, confident launch energy — like you just unveiled something cool: One wallet. All your AI API keys.',
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-02-1280x800.png'), // multi-provider dashboard
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
  },
  {
    id: 'ph02-control',
    text: 'Say with calm authority, like you\'re laying down the rules: Devs can connect and use them — as much as YOU allow them to.',
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-05-1280x800.png'), // apps you control
      path.join(COMPOSITES, 'chrome-store-04-1280x800.png'), // see every request
    ],
  },
  {
    id: 'ph03-bills',
    text: 'Say with relief, like a weight has been lifted, but punchy: No more crazy AI bills. For anyone.',
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-06-1280x800.png'), // total visibility / usage
      path.join(COMPOSITES, 'chrome-store-04-1280x800.png'), // see every request
    ],
  },
  {
    id: 'ph04-gifts',
    text: 'Say in a clever, conspiratorial tone — like sharing a lifehack: Want to hook up a friend? Mint them a gift. Cap the budget. Kill it whenever.',
    frameCandidates: [
      path.join(COMPOSITES, 'chrome-store-03-1280x800.png'), // send AI as a gift
    ],
  },
  {
    id: 'ph05-cta',
    text: 'Say with enthusiastic launch energy. Pronounce "byoky" as bye-oh-kee, spelling it out clearly: Head to bye-oh-kee dot com. B, Y, O, K, Y dot com. Let\'s connect and build.',
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-cover-1270x760.png'),
      path.join(COMPOSITES, 'eye-catcher-multi-1920x1080.png'),
    ],
    hero: 'byoky.com',
  },
  {
    id: 'ph06-bye',
    text: 'Say warmly and casually, like casually waving goodbye to a friend: Okay! Thanks! Bye!',
    frameCandidates: [
      path.join(COMPOSITES, 'product-hunt-thumb-240x240.png'),
      path.join(COMPOSITES, 'product-hunt-header-1200x630.png'),
    ],
  },
];

// ─── TTS ────────────────────────────────────────────────────────────────
interface TtsResponse {
  candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
  error?: { message?: string };
}

async function tts(text: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${await res.text()}`);
  const json: TtsResponse = await res.json();
  if (json.error) throw new Error(`Gemini TTS: ${json.error.message}`);
  const data = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('Gemini TTS returned no audio');
  return Buffer.from(data, 'base64');
}

function pcmToWav(pcm: Buffer): Buffer {
  const sampleRate = 24_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = pcm.length;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataSize, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  h.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataSize, 40);
  return Buffer.concat([h, pcm]);
}

function wavSeconds(wav: Buffer): number {
  const sampleRate = wav.readUInt32LE(24);
  const dataSize = wav.length - 44;
  return dataSize / (sampleRate * 2);
}

// ─── Video ──────────────────────────────────────────────────────────────
const VIDEO_W = 1920;
const VIDEO_H = 1080;
const FPS = 30;

function probeDims(p: string): { width: number; height: number } {
  const out = execSync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "${p}"`,
    { encoding: 'utf-8' },
  ).trim();
  const [w, h] = out.split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
}

function pickFrame(seg: Segment): string {
  for (const c of seg.frameCandidates) if (fs.existsSync(c)) return c;
  throw new Error(`No composite found for ${seg.id} — run pnpm compose first`);
}

function beatFilter(
  imgPath: string,
  dur: number,
  beatIdx: number,
  totalBeats: number,
  hero?: string,
): string {
  const { width, height } = probeDims(imgPath);
  const aspect = width / height;
  const videoAspect = VIDEO_W / VIDEO_H;
  const isLandscape = Math.abs(aspect - videoAspect) < 0.25;

  // scale+lanczos smooth zoom (no zoompan rounding wobble)
  const zoomExpr = `1.0+0.04*t/${dur.toFixed(2)}`;

  const bgChain = isLandscape
    ? `[0:v]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=decrease,pad=${VIDEO_W}:${VIDEO_H}:(ow-iw)/2:(oh-ih)/2:color=#141418[main]`
    : [
        `[0:v]split=2[bg0][fg0]`,
        `[bg0]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=increase,crop=${VIDEO_W}:${VIDEO_H},boxblur=40:2,eq=brightness=-0.08[bg]`,
        `[fg0]scale=${VIDEO_W}:${VIDEO_H}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[main]`,
      ].join(';');

  // Progress bar
  const progressStart = beatIdx / totalBeats;
  const progressDelta = 1 / totalBeats;
  const barH = 6;
  const barWidthExpr = `iw*(${progressStart.toFixed(4)}+${progressDelta.toFixed(4)}*t/${dur.toFixed(2)})`;
  const drawbox = `drawbox=x=0:y=ih-${barH}:w='${barWidthExpr}':h=${barH}:color=0x0ea5e9@1.0:t=fill`;

  // Hero caption (only on beats that set it)
  let heroExpr: string | null = null;
  if (hero) {
    const heroFontSize = Math.round(VIDEO_H * 0.14);
    const escaped = hero.replace(/'/g, "\\'").replace(/:/g, '\\:');
    const heroAlpha = `if(lt(t,0.5),max(0,t-0.1)/0.4,if(gt(t,${(dur - 0.4).toFixed(2)}),max(0,1-(t-${(dur - 0.4).toFixed(2)})/0.4),1))`;
    heroExpr = `drawtext=text='${escaped}':fontfile='/System/Library/Fonts/SFNS.ttf':fontsize=${heroFontSize}:fontcolor=white@1.0:alpha='${heroAlpha}':x=(w-text_w)/2:y=(h-text_h)/2+120:borderw=4:bordercolor=0x141418`;
  }

  const smoothZoom =
    `scale=w='${VIDEO_W}*${zoomExpr}':h='${VIDEO_H}*${zoomExpr}':flags=lanczos:eval=frame,` +
    `crop=${VIDEO_W}:${VIDEO_H}:(in_w-${VIDEO_W})/2:(in_h-${VIDEO_H})/2,` +
    `fps=${FPS}`;

  const overlays = [heroExpr, drawbox].filter(Boolean);
  return [
    bgChain,
    `[main]${smoothZoom}[zoomed]`,
    `[zoomed]${overlays.join(',')},format=yuv420p[out]`,
  ].join(';');
}

// ─── Main ───────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n🎤 Product Hunt video — Gemini TTS (voice: ${VOICE})\n`);

  // 1. Narrate all segments
  const meta: { id: string; file: string; duration: number }[] = [];
  const segmentsWavs: Buffer[] = [];
  for (const seg of SEGMENTS) {
    process.stdout.write(`  ⏳ ${seg.id}...`);
    const pcm = await tts(seg.text);
    const wav = pcmToWav(pcm);
    const file = path.join(VOICEOVER_DIR, `${seg.id}.wav`);
    fs.writeFileSync(file, wav);
    const dur = wavSeconds(wav);
    meta.push({ id: seg.id, file, duration: dur });
    segmentsWavs.push(pcm);
    // Add 300ms gap between segments (except last)
    segmentsWavs.push(Buffer.alloc(14400)); // 24kHz * 0.3s * 2 bytes/sample
    console.log(` ✓ (${dur.toFixed(2)}s)`);
  }
  segmentsWavs.pop(); // drop trailing silence

  const fullWav = pcmToWav(Buffer.concat(segmentsWavs));
  const narrationPath = path.join(VOICEOVER_DIR, 'narration.wav');
  fs.writeFileSync(narrationPath, fullWav);
  console.log(`  ✓ merged narration: ${wavSeconds(fullWav).toFixed(2)}s\n`);

  // 2. Build per-beat clips
  console.log('🎬 Rendering beats...\n');
  const beatClips: string[] = [];
  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    const dur = meta[i].duration + 0.3;
    const img = pickFrame(seg);
    const clip = path.join(TMP, `beat-${seg.id}.mp4`);
    const filter = beatFilter(img, dur, i, SEGMENTS.length, seg.hero);
    const r = spawnSync(
      'ffmpeg',
      [
        '-y', '-loop', '1', '-i', img,
        '-t', String(dur),
        '-filter_complex', filter, '-map', '[out]',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-r', String(FPS),
        '-preset', 'medium', '-crf', '20',
        clip,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    if (r.status !== 0) {
      console.error(r.stderr?.toString());
      throw new Error(`ffmpeg failed on ${seg.id}`);
    }
    beatClips.push(clip);
    console.log(`  ✓ ${seg.id} (${dur.toFixed(2)}s)`);
  }

  // 3. Concat
  const listFile = path.join(TMP, 'concat.txt');
  fs.writeFileSync(listFile, beatClips.map((v) => `file '${v}'`).join('\n'));
  const silentMp4 = path.join(TMP, 'silent.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${silentMp4}"`, { stdio: 'pipe' });

  // 4. Audio bed (whooshes + quiet music), reusing the same pattern as
  // video.ts but lighter: no sidechain — just a quiet pad behind the voice.
  const totalDur = meta.reduce((a, m) => a + m.duration + 0.3, 0);
  const musicWav = path.join(TMP, 'music.wav');
  execSync(
    [
      'ffmpeg -y',
      `-f lavfi -i "sine=frequency=110:duration=${totalDur.toFixed(2)}:sample_rate=48000"`,
      `-f lavfi -i "sine=frequency=164.81:duration=${totalDur.toFixed(2)}:sample_rate=48000"`,
      `-f lavfi -i "sine=frequency=55:duration=${totalDur.toFixed(2)}:sample_rate=48000"`,
      '-filter_complex',
      '"' +
        [
          `[0:a]volume=0.3,tremolo=f=0.25:d=0.2[pad1]`,
          `[1:a]volume=0.2,tremolo=f=0.25:d=0.2[pad2]`,
          `[2:a]volume=0.55,tremolo=f=2:d=1.0[kickA]`,
          `[kickA]highpass=f=40,lowpass=f=120,volume=0.45[kick]`,
          `[pad1][pad2]amix=inputs=2:duration=first:dropout_transition=0,volume=-3dB[padmix]`,
          `[padmix][kick]amix=inputs=2:duration=first:dropout_transition=0[music]`,
          `[music]lowpass=f=3000,highpass=f=60,volume=0.4,afade=t=in:st=0:d=0.5,afade=t=out:st=${(totalDur - 0.5).toFixed(2)}:d=0.5[out]`,
        ].join(';') +
        '"',
      '-map "[out]"',
      musicWav,
    ].join(' '),
    { stdio: 'pipe' },
  );

  // Whoosh at each beat boundary
  const whoosh = path.join(TMP, 'whoosh.wav');
  execSync(
    `ffmpeg -y -f lavfi -i "anoisesrc=d=0.14:c=white:r=48000:a=0.7" -af "highpass=f=400,lowpass=f=4000,afade=t=in:st=0:d=0.02,afade=t=out:st=0.09:d=0.05,volume=-6dB" "${whoosh}"`,
    { stdio: 'pipe' },
  );

  // Build delays for whooshes (one at start of each beat)
  const beatStarts: number[] = [];
  let cursor = 0;
  for (const m of meta) {
    beatStarts.push(cursor);
    cursor += m.duration + 0.3;
  }

  const inputs = [
    `-i "${narrationPath}"`,
    `-i "${musicWav}"`,
    ...beatStarts.map(() => `-i "${whoosh}"`),
  ].join(' ');

  const mixFilter = [
    `[0:a]acompressor=threshold=-18dB:ratio=3:attack=5:release=50,volume=+2dB[voice]`,
    `[1:a][voice]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]`,
    `[ducked]volume=-18dB[musicQuiet]`,
    ...beatStarts.map(
      (t, i) => `[${i + 2}:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=-2dB[w${i}]`,
    ),
    `[voice][musicQuiet]${beatStarts.map((_, i) => `[w${i}]`).join('')}amix=inputs=${2 + beatStarts.length}:duration=first:dropout_transition=0:normalize=0,volume=1.1[finalAudio]`,
  ].join(';');

  const finalAudio = path.join(TMP, 'final-audio.wav');
  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${mixFilter}" -map "[finalAudio]" "${finalAudio}"`,
    { stdio: 'pipe' },
  );

  // 5. Mux + export variants
  const finalMp4 = path.join(OUT, 'product-hunt.mp4');
  execSync(
    `ffmpeg -y -i "${silentMp4}" -i "${finalAudio}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${finalMp4}"`,
    { stdio: 'pipe' },
  );

  // Square 1080×1080 + Vertical 1080×1920: scale-to-fit the full 16:9 content
  // into the new aspect, then fill the dead top/bottom bars with a blurred
  // copy of the same frame. Previous crop-from-center lost the headline/sub
  // text on every slide.
  const squareMp4 = path.join(OUT, 'product-hunt-square-1080.mp4');
  execSync(
    `ffmpeg -y -i "${finalMp4}" -filter_complex "` +
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=40:2,eq=brightness=-0.1[bg];` +
      `[fg]scale=1080:-1:flags=lanczos[fg];` +
      `[bg][fg]overlay=0:(H-h)/2,format=yuv420p[out]"` +
      ` -map "[out]" -map 0:a -c:v libx264 -pix_fmt yuv420p -preset medium -crf 22 -c:a copy "${squareMp4}"`,
    { stdio: 'pipe' },
  );

  const verticalMp4 = path.join(OUT, 'product-hunt-vertical-1080x1920.mp4');
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
  console.log(`\n✓ ${path.basename(finalMp4)} (${sizeMb} MB, ${totalDur.toFixed(1)}s)`);
  console.log(`✓ ${path.basename(squareMp4)}`);
  console.log(`✓ ${path.basename(verticalMp4)}\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
