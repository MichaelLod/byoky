import { ImageResponse } from 'next/og';
import { decodeGiftLink, validateGiftLink, type GiftLink } from '@byoky/sdk';

export const alt = 'Byoky token gift';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Expired';
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return `${Math.ceil(diff / 60_000)} min left`;
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}

type Params = Promise<{ encoded: string }>;

export default async function Image({ params }: { params: Params }) {
  const { encoded } = await params;
  const link = decodeGiftLink(encoded);
  const valid = link && validateGiftLink(link).valid;
  const gift: GiftLink | null = valid ? link : null;

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
          padding: '72px 96px',
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
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '12px 22px',
            borderRadius: 999,
            background: 'rgba(255, 79, 0, 0.14)',
            border: '1px solid rgba(255, 79, 0, 0.42)',
            fontSize: 24,
            fontWeight: 600,
            color: '#FF4F00',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: 40,
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#FF4F00',
              boxShadow: '0 0 10px #FF4F00',
              display: 'flex',
            }}
          />
          Byoky token gift
        </div>

        {gift ? (
          <>
            <div
              style={{
                fontSize: 132,
                fontWeight: 800,
                letterSpacing: '-0.04em',
                color: '#FF4F00',
                lineHeight: 1,
                display: 'flex',
              }}
            >
              {formatTokens(gift.m)}
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                marginTop: 6,
                display: 'flex',
              }}
            >
              {gift.n} tokens
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.78)',
                marginTop: 32,
                display: 'flex',
              }}
            >
              from {gift.s}
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                marginTop: 44,
                fontSize: 26,
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.6)',
              }}
            >
              <div style={{ display: 'flex' }}>{formatExpiry(gift.e)}</div>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.3)',
                  display: 'flex',
                }}
              />
              <div style={{ display: 'flex' }}>Open in Byoky to accept</div>
            </div>
          </>
        ) : (
          <>
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
                display: 'flex',
              }}
            >
              Open in Byoky to accept · byoky.com
            </div>
          </>
        )}
      </div>
    ),
    size,
  );
}
