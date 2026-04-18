import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Byoky token gift';
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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 30% 20%, rgba(255, 79, 0, 0.18), transparent 55%), radial-gradient(circle at 75% 80%, rgba(255, 106, 42, 0.12), transparent 60%), #0b0b0c',
          fontFamily: 'sans-serif',
          color: '#ffffff',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 180,
            height: 180,
            borderRadius: 44,
            background: 'rgba(255, 79, 0, 0.14)',
            border: '2px solid rgba(255, 79, 0, 0.42)',
            marginBottom: 44,
            boxShadow: '0 0 80px rgba(255, 79, 0, 0.35)',
          }}
        >
          <svg
            width="110"
            height="110"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FF4F00"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 12v10H4V12" />
            <path d="M2 7h20v5H2z" />
            <path d="M12 22V7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
        </div>
        <div
          style={{
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            margin: 0,
          }}
        >
          A token gift for you
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.72)',
            marginTop: 20,
            letterSpacing: '-0.01em',
          }}
        >
          Open in Byoky to accept · byoky.com
        </div>
      </div>
    ),
    size,
  );
}
