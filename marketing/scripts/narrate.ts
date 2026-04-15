/**
 * Generate the walkthrough voiceover via Gemini 2.5 Flash TTS.
 *
 * Reads narration text from this file (single source of truth — also referenced
 * by video.ts to time the slides), splits into segments, calls the Gemini API
 * for each, wraps the returned PCM bytes in a WAV header, and emits:
 *
 *   marketing/voiceover/segments/SS-name.wav   (per-segment WAVs)
 *   marketing/voiceover/narration.wav          (one concatenated WAV)
 *   marketing/voiceover/narration.json         (segment metadata + timings)
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'marketing/voiceover');
const SEG_DIR = path.join(OUT, 'segments');
fs.mkdirSync(SEG_DIR, { recursive: true });

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
  console.error('✗ GEMINI_API_KEY missing — set it in .env.local');
  process.exit(1);
}

// Voice options: Kore, Puck, Charon, Fenrir, Aoede, Leda, Orus, Zephyr.
// Puck = upbeat, punchy, launch-video energy. Perfect for a 40-second hook.
const VOICE = process.env.BYOKY_TTS_VOICE || 'Puck';
const MODEL = 'gemini-2.5-flash-preview-tts';

// Segments — each is one beat of the walkthrough video. Each text is prefixed
// with a per-beat *delivery instruction* that Gemini TTS respects. This is
// what keeps the voice from sounding like a monotone news anchor — different
// beats get different energy: tired sarcasm on the hook, excited pitch on
// features, conspiratorial on gifts, triumphant on the CTA.
export interface Segment {
  id: string;
  text: string;
}

export const SEGMENTS: Segment[] = [
  {
    id: '01-hook',
    text: 'Say with tired, slightly exasperated sarcasm, like you are fed up: Okay. Another AI app. Another key. Paste. Again.',
  },
  {
    id: '02-intro',
    text: "Say with bright, confident launch energy — like you just cracked the secret: Stop. There's a better way. One wallet. Your keys. Your rules.",
  },
  {
    id: '03-multi-provider',
    text: 'Say with excited, fast-paced enthusiasm, stacking features: Anthropic. OpenAI. Gemini. Drop them in. Any app, any model. One click, connected.',
  },
  {
    id: '04-gifts',
    text: 'Say in a conspiratorial, clever tone — like sharing a lifehack: Want to hook up a friend? Mint them a gift. Cap the budget. Kill it whenever.',
  },
  {
    id: '05-cross-device',
    text: 'Say with expansive, impressed wonder, like the camera pulls back to reveal scale: And on your phone? Yeah. iOS. Android. Same vault. Zero sync drama.',
  },
  {
    id: '06-call-to-action',
    // "Byoky" is not a real word, so spell it out — otherwise Gemini tends to
    // swallow the trailing 'y' and say "Byok dot com". Letter-by-letter is
    // clearest and also doubles as a memorable brand beat.
    text: 'Say triumphantly, with a punchy landing. Pronounce "byoky" as bye-oh-kee, not byok: Bring your own key. Take it back. Bye-oh-kee dot com. That\'s B, Y, O, K, Y dot com.',
  },
];

interface GeminiTtsResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
  }[];
  error?: { message?: string };
}

async function tts(text: string, voice: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY! },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini TTS HTTP ${res.status}: ${errText}`);
  }
  const json: GeminiTtsResponse = await res.json();
  if (json.error) throw new Error(`Gemini TTS error: ${json.error.message}`);
  const data = json.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('Gemini TTS returned no audio data');
  return Buffer.from(data, 'base64');
}

/** Wrap raw 24kHz mono 16-bit PCM into a WAV file. */
function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function wavDurationSec(wav: Buffer): number {
  const sampleRate = wav.readUInt32LE(24);
  const bitsPerSample = wav.readUInt16LE(34);
  const channels = wav.readUInt16LE(22);
  const dataSize = wav.length - 44;
  return dataSize / ((sampleRate * channels * bitsPerSample) / 8);
}

(async () => {
  console.log(`\n🎤 Generating narration with Gemini TTS (voice: ${VOICE})\n`);
  const meta: { id: string; text: string; file: string; duration: number; offset: number }[] = [];
  let offset = 0;
  const allPcm: Buffer[] = [];

  for (const seg of SEGMENTS) {
    process.stdout.write(`  ⏳ ${seg.id} ...`);
    const pcm = await tts(seg.text, VOICE);
    const wav = pcmToWav(pcm);
    const file = path.join(SEG_DIR, `${seg.id}.wav`);
    fs.writeFileSync(file, wav);
    const dur = wavDurationSec(wav);
    meta.push({ id: seg.id, text: seg.text, file, duration: dur, offset });
    offset += dur + 0.4; // 400ms gap between beats
    allPcm.push(pcm);
    // Insert a small silence (24kHz mono 16-bit, 400ms = 9600 samples = 19200 bytes)
    allPcm.push(Buffer.alloc(19200));
    console.log(` ✓ (${dur.toFixed(2)}s)`);
  }

  // Concatenated WAV (drop trailing silence)
  allPcm.pop();
  const fullPcm = Buffer.concat(allPcm);
  const fullWav = pcmToWav(fullPcm);
  fs.writeFileSync(path.join(OUT, 'narration.wav'), fullWav);
  fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify(meta, null, 2));

  const total = wavDurationSec(fullWav);
  console.log(`\n✓ Wrote narration.wav (${total.toFixed(2)}s total) + ${SEGMENTS.length} segments`);
})().catch((err) => {
  console.error('\n✗ TTS failed:', err.message);
  process.exit(1);
});
