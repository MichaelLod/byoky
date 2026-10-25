import { ImageResponse } from 'next/og';

/*
 * The 1200x630 social card in the retro-security look: void ground, dot
 * grid, Chakra Petch headline, and Muninn on his key. Shared by the
 * opengraph-image routes.
 */

export const ogSize = { width: 1200, height: 630 };

const VOID = '#07060A';
const SEAM = '#2A2236';
const BONE = '#ECE8F4';
const FOG = '#A79FB8';
const DIM = '#857C95';
const VIOLET = '#7C3AED';
const PHOSPHOR = '#A78BFA';
const SIGNAL = '#4ADE80';
const INK = '#0B0910';

type Font = { name: string; data: ArrayBuffer; weight: 500 | 600 | 700; style: 'normal' };

// Google Fonts serves TTF to clients that don't ask for WOFF2, which is what
// ImageResponse can read. `text` subsets the file to the glyphs we draw.
async function loadGoogleFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!src) throw new Error(`no TTF for ${family}`);
  const res = await fetch(src[1]);
  if (!res.ok) throw new Error(`font fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

async function loadFonts(display: string, mono: string): Promise<Font[]> {
  try {
    const [chakra, plexMono] = await Promise.all([
      loadGoogleFont('Chakra+Petch', 700, display),
      loadGoogleFont('IBM+Plex+Mono', 500, mono),
    ]);
    return [
      { name: 'Chakra Petch', data: chakra, weight: 700, style: 'normal' },
      { name: 'IBM Plex Mono', data: plexMono, weight: 500, style: 'normal' },
    ];
  } catch {
    // Offline build: fall back to ImageResponse's bundled bold sans.
    return [];
  }
}

function Raven() {
  return (
    <svg width="360" height="360" viewBox="0 0 240 240">
      <g transform="translate(240 0) scale(-1 1)">
        <circle cx="52" cy="200" r="14" fill="none" stroke={VIOLET} strokeWidth="7" />
        <rect x="65" y="196.5" width="135" height="7" fill={VIOLET} />
        <rect x="172" y="203" width="7" height="13" fill={VIOLET} />
        <rect x="186" y="203" width="7" height="8" fill={VIOLET} />
        <polygon points="84,170 112,178 80,214 44,222 58,194" fill="#0E0B14" />
        <polygon points="84,170 96,176 58,214 44,222" fill="#1D1629" />
        <rect x="117" y="176" width="4" height="21" fill="#3B2D55" />
        <rect x="133" y="174" width="4" height="23" fill="#3B2D55" />
        <polygon points="108,96 130,90 152,98 166,122 162,152 142,174 112,182 84,172 70,150 84,118" fill={INK} />
        <polygon points="152,98 166,122 162,152 146,128" fill="#17121F" />
        <polygon points="104,106 146,120 144,150 118,176 86,170 78,142" fill="#1A1424" />
        <polygon points="104,106 146,120 120,132 84,128" fill="#271D38" />
        <polygon points="86,150 132,138 134,142 90,156" fill="#2F2444" />
        <polygon points="92,164 128,154 129,158 96,169" fill="#2F2444" />
        <polygon points="84,118 108,96 113,100 89,123" fill="#8B5CF6" opacity="0.6" />
        <g transform="rotate(6 140 96)">
          <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill={INK} />
          <polygon points="148,38 170,44 160,58" fill="#231A33" />
          <polygon points="120,70 126,50 138,62" fill="#17121F" />
          <polygon points="174,56 222,74 176,84" fill="#1F1830" />
          <polygon points="174,56 222,74 178,70" fill="#3B2D55" />
          <polygon points="126,50 148,38 149,42 129,54" fill={PHOSPHOR} opacity="0.75" />
          <ellipse cx="160" cy="62" rx="7" ry="7" fill="#C4B5FD" />
          <circle cx="162.5" cy="63" r="3.4" fill={VOID} />
        </g>
      </g>
    </svg>
  );
}

function LogoTile() {
  // docs/brand/app-icon-small.svg: Muninn's head, the app icon.
  return (
    <svg width="64" height="64" viewBox="0 0 1024 1024">
      <defs>
        <radialGradient id="glow" cx="0.60" cy="0.32" r="0.66">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity="0" />
        </radialGradient>
        <clipPath id="tile">
          <rect width="1024" height="1024" rx="230" />
        </clipPath>
      </defs>
      <g clipPath="url(#tile)">
        <rect width="1024" height="1024" fill={INK} />
        <rect width="1024" height="1024" fill="url(#glow)" />
        <g transform="translate(488 168) scale(7.4) translate(-162 -38)">
          <polygon points="122,76 152,94 168,130 172,230 100,230 98,120" fill="#1C1529" />
          <polygon points="152,94 168,130 172,230 150,230 156,128" fill="#271E3A" />
          <polygon points="122,76 98,120 100,230 95,230 95,118" fill="#8B5CF6" />
          <polygon points="126,50 148,38 170,44 180,62 176,86 152,98 130,90 120,70" fill="#2E2344" />
          <polygon points="148,38 170,44 160,58" fill="#4A3970" />
          <polygon points="120,70 126,50 138,62" fill="#221A33" />
          <polygon points="130,90 152,98 176,86 152,80" fill="#221A33" />
          <polygon points="146,92 168,90 160,112" fill="#3A2C58" />
          <polygon points="158,90 178,86 172,104" fill="#2E2344" />
          <polygon points="138,94 152,98 146,116" fill="#2A2040" />
          <polygon points="172,52 226,72 212,78 176,70" fill="#A78BFA" />
          <polygon points="176,70 216,76 178,86" fill="#7C3AED" />
          <polygon points="126,50 148,38 149,42 129,54" fill="#C4B5FD" />
          <circle cx="160" cy="62" r="9.5" fill="#7C3AED" opacity="0.45" />
          <ellipse cx="160" cy="62" rx="6" ry="6" fill="#DDD6FE" />
          <circle cx="161.5" cy="62" r="3" fill="#07060A" />
        </g>
      </g>
    </svg>
  );
}

export async function ogCard({
  badge,
  headline,
  accent,
  sub,
}: {
  badge: string;
  headline: string;
  accent: string;
  sub: string;
}) {
  const display = `BYOKY ${headline} ${accent}_`;
  const mono = `${badge} > byoky.com_ ${sub}`;
  const fonts = await loadFonts(display, mono);
  const displayFont = fonts.length ? 'Chakra Petch' : 'sans-serif';
  const monoFont = fonts.length ? 'IBM Plex Mono' : 'monospace';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          position: 'relative',
          backgroundColor: VOID,
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(167, 139, 250, 0.14) 1px, transparent 0)',
          backgroundSize: '32px 32px',
          color: BONE,
          fontFamily: displayFont,
        }}
      >
        <div style={{ position: 'absolute', right: 40, bottom: 24, display: 'flex' }}>
          <Raven />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <LogoTile />
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: '0.08em' }}>BYOKY</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginLeft: 16,
              padding: '10px 18px',
              border: `1px solid ${SEAM}`,
              background: '#100D16',
              fontFamily: monoFont,
              fontSize: 20,
              letterSpacing: '0.12em',
              color: FOG,
            }}
          >
            <div style={{ width: 10, height: 10, background: SIGNAL, display: 'flex' }} />
            {badge}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', fontWeight: 700, fontSize: 96, lineHeight: 0.98 }}>
          <div style={{ display: 'flex' }}>{headline}</div>
          <div style={{ display: 'flex', color: PHOSPHOR }}>{accent}_</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 700 }}>
          <div style={{ display: 'flex', fontFamily: monoFont, fontSize: 24, lineHeight: 1.45, color: FOG }}>{sub}</div>
          <div style={{ display: 'flex', gap: 14, fontFamily: monoFont, fontSize: 24, color: DIM }}>
            <span style={{ color: PHOSPHOR }}>&gt;</span>
            <span>byoky.com</span>
          </div>
        </div>
      </div>
    ),
    { ...ogSize, fonts },
  );
}
