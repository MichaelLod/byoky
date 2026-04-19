import { ImageResponse } from 'next/og';

export const alt = 'Run Claude Code, Codex, and Gemini in OpenClaw — with Byoky';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#fafaf9',
          padding: 40,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            borderRadius: 28,
            border: '1px solid rgba(255, 79, 0, 0.20)',
            background:
              'linear-gradient(135deg, #fff5ef 0%, #fafaf9 55%, #fff5ef 100%)',
            padding: '52px 56px',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1.05,
              paddingRight: 40,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 18,
                fontWeight: 700,
                color: '#FF4F00',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                marginBottom: 26,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#FF4F00',
                  display: 'flex',
                }}
              />
              OpenClaw × Byoky
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 56,
                fontWeight: 800,
                letterSpacing: '-0.035em',
                lineHeight: 1.05,
                color: '#1c1917',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span>Run</span>
                <ClaudeIcon />
                <span>Claude Code,</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <OpenAIIcon />
                <span>Codex, and</span>
                <GeminiIcon />
                <span>Gemini</span>
              </div>
              <div style={{ display: 'flex' }}>in OpenClaw.</div>
            </div>

            <div
              style={{
                marginTop: 26,
                fontSize: 22,
                lineHeight: 1.45,
                color: '#57534e',
                display: 'flex',
                flexDirection: 'column',
                maxWidth: 540,
              }}
            >
              <div style={{ display: 'flex' }}>
                Use an existing <b style={{ color: '#1c1917', margin: '0 6px' }}>Claude Pro/Max</b>
              </div>
              <div style={{ display: 'flex' }}>
                subscription, or accept a gifted
              </div>
              <div style={{ display: 'flex' }}>
                token budget. No new API account —
              </div>
              <div style={{ display: 'flex' }}>just a 5-minute setup.</div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                marginTop: 'auto',
                paddingTop: 28,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px 26px',
                  background: '#FF4F00',
                  color: '#fff',
                  borderRadius: 12,
                  fontSize: 20,
                  fontWeight: 700,
                }}
              >
                Read the 5-minute setup
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px 26px',
                  background: '#ffffff',
                  color: '#1c1917',
                  borderRadius: 12,
                  fontSize: 20,
                  fontWeight: 600,
                  border: '1px solid #e7e5e4',
                }}
              >
                Browse free gifts
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              border: '1px solid #e7e5e4',
              borderRadius: 16,
              padding: '28px 30px',
              fontFamily: 'monospace',
              fontSize: 17,
              lineHeight: 1.7,
              boxShadow: '0 8px 28px rgba(28, 25, 23, 0.06)',
              alignSelf: 'center',
            }}
          >
            <div style={{ display: 'flex', color: '#a8a29e' }}>
              # Install the plugin (bridge bundled)
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 20 }}>
              <span style={{ color: '#7c3aed', marginRight: 10 }}>$</span>
              <span style={{ color: '#1c1917' }}>openclaw plugins install&nbsp;</span>
              <span style={{ color: '#16a34a' }}>@byoky/openclaw-plugin</span>
            </div>

            <div style={{ display: 'flex', color: '#a8a29e' }}>
              # Connect your wallet
            </div>
            <div style={{ display: 'flex' }}>
              <span style={{ color: '#7c3aed', marginRight: 10 }}>$</span>
              <span style={{ color: '#1c1917' }}>openclaw models auth login \</span>
            </div>
            <div style={{ display: 'flex', marginBottom: 20, paddingLeft: 22 }}>
              <span style={{ color: '#1c1917' }}>--provider&nbsp;</span>
              <span style={{ color: '#16a34a' }}>byoky-anthropic</span>
            </div>

            <div style={{ display: 'flex' }}>
              <span style={{ color: '#16a34a', marginRight: 10 }}>✓</span>
              <span style={{ color: '#1c1917' }}>bridge running</span>
            </div>
            <div style={{ display: 'flex' }}>
              <span style={{ color: '#16a34a', marginRight: 10 }}>✓</span>
              <span style={{ color: '#0ea5e9', marginRight: 6 }}>13</span>
              <span style={{ color: '#1c1917' }}>providers available</span>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function ClaudeIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="#D97706" style={{ display: 'flex' }}>
      <path d="M12 2 L13.2 9.6 L21 8 L14.6 12 L21 16 L13.2 14.4 L12 22 L10.8 14.4 L3 16 L9.4 12 L3 8 L10.8 9.6 Z" />
    </svg>
  );
}

function OpenAIIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#1c1917" strokeWidth="1.6" style={{ display: 'flex' }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3 C7 6, 7 18, 12 21" />
      <path d="M12 3 C17 6, 17 18, 12 21" />
      <path d="M3 12 C6 7, 18 7, 21 12" />
    </svg>
  );
}

function GeminiIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="#0ea5e9" style={{ display: 'flex' }}>
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  );
}
