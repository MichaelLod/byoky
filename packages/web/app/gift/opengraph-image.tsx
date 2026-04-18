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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0b0c',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -200,
            left: -200,
            width: 800,
            height: 800,
            borderRadius: '50%',
            background: 'rgba(255, 79, 0, 0.22)',
            filter: 'blur(120px)',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -200,
            right: -200,
            width: 700,
            height: 700,
            borderRadius: '50%',
            background: 'rgba(255, 106, 42, 0.18)',
            filter: 'blur(120px)',
            display: 'flex',
          }}
        />

        <div
          style={{
            position: 'relative',
            width: 220,
            height: 220,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 52,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 44,
              background: 'rgba(255, 79, 0, 0.14)',
              border: '2px solid rgba(255, 79, 0, 0.55)',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'relative',
              width: 150,
              height: 120,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                height: 28,
                background: '#FF4F00',
                borderRadius: 6,
                marginBottom: 6,
                display: 'flex',
              }}
            />
            <div
              style={{
                flex: 1,
                background: '#FF4F00',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: '100%',
                  background: '#0b0b0c',
                  display: 'flex',
                }}
              />
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 18,
                height: '100%',
                background: '#0b0b0c',
                display: 'flex',
              }}
            />
          </div>
        </div>

        <div
          style={{
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            display: 'flex',
          }}
        >
          A token gift for you
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.7)',
            marginTop: 22,
            letterSpacing: '-0.01em',
            display: 'flex',
          }}
        >
          Open in Byoky to accept · byoky.com
        </div>
      </div>
    ),
    size,
  );
}
