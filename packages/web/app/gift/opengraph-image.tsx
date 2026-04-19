import { ImageResponse } from 'next/og';

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
          position: 'relative',
          background: '#fafaf9',
          color: '#1c1917',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -260,
            right: -220,
            width: 780,
            height: 780,
            borderRadius: '50%',
            background: 'rgba(255, 79, 0, 0.22)',
            filter: 'blur(140px)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -240,
            left: -200,
            width: 680,
            height: 680,
            borderRadius: '50%',
            background: 'rgba(255, 106, 42, 0.14)',
            filter: 'blur(140px)',
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '72px 80px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: '#FF4F00',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: 52,
                fontWeight: 800,
                letterSpacing: '-0.04em',
              }}
            >
              b
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: '#1c1917',
                display: 'flex',
              }}
            >
              byoky
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginLeft: 20,
                padding: '10px 20px',
                borderRadius: 999,
                background: 'rgba(255, 79, 0, 0.1)',
                border: '1px solid rgba(255, 79, 0, 0.35)',
                fontSize: 22,
                fontWeight: 600,
                color: '#FF4F00',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              <div
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: '#FF4F00',
                  boxShadow: '0 0 10px #FF4F00',
                  display: 'flex',
                }}
              />
              <div style={{ display: 'flex' }}>Token gift</div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 96,
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 1.02,
                color: '#1c1917',
                display: 'flex',
              }}
            >
              A token gift
            </div>
            <div
              style={{
                fontSize: 96,
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 1.02,
                color: '#FF4F00',
                display: 'flex',
              }}
            >
              for you.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 500,
                color: '#57534e',
                display: 'flex',
              }}
            >
              Open in Byoky to accept
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: '#1c1917',
                display: 'flex',
                letterSpacing: '-0.01em',
              }}
            >
              byoky.com
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
