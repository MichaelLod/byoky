import { ImageResponse } from 'next/og';
import { decodeGiftLink, validateGiftLink, type GiftLink } from '@byoky/sdk';

export const alt = 'Byoky token gift';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const LOGO_DATA_URI =
  'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiID8+PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MzAiIGhlaWdodD0iNjMwIiB2aWV3Qm94PSIwIDAgNjMwIDYzMCI+PHJlY3Qgd2lkdGg9IjYzMCIgaGVpZ2h0PSI2MzAiIHJ4PSIxMjMiIHJ5PSIxMjMiIGZpbGw9IiNGRjRGMDAiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg5NSwgNjApIj48cGF0aCBmaWxsPSIjRkZGRkZGIiBkPSJNMCAxMjYuNTcyQzAuNzM2NzY4IDEyNC45OTMgMC44OTI5OTEgMTIwLjUzIDEuMjIzMDMgMTE4LjUyNUM3LjE4MjM0IDgyLjMyNzggMzIuNTM2NiA1Mi4zNzE3IDY3LjIxNDYgNDAuMzU0NkM4Mi41OTA0IDM1LjAyNjMgOTQuMDM1MiAzNC45MjczIDExMC4zMzEgMzQuOTMxOEwxMzkuNTE1IDM0LjkzNUwyMzAuOTc0IDM0LjkzNTNMMzA4LjA4MSAzNC45MjlMMzMyLjI3NSAzNC45MjgzQzM1MS45MTIgMzQuOTMxNSAzNjUuMSAzNi4wODQ4IDM4My4yODggNDQuNzU5QzQwOC42ODcgNTYuOTQ4OCA0MjcuODEgNzkuMjMyMyA0MzYuMDAzIDEwNi4xODdDNDM3LjMyMSAxMTAuNDA4IDQzOC4wODEgMTE0LjU0OCA0MzguODMgMTE4Ljg5OEM0MzkuMTgxIDEyMC45NDEgNDM5LjI3MiAxMjQuMyA0NDAgMTI2LjEyOEw0NDAgMzg0LjE3MUM0MzkuNTY1IDM4NS4yMjMgNDM4LjQ4IDM5My4wNTcgNDM4LjA5MSAzOTUuMDY0QzQzNi42ODIgNDAyLjI4NiA0MzQuNDI2IDQwOS4zMTYgNDMxLjM3IDQxNi4wMUM0MjAuMzUzIDQ0MC4zNjYgNDAwLjA5NiA0NTkuMzM2IDM3NS4wNyA0NjguNzMzQzM2Ni4xMzMgNDcyLjA5NyAzNTYuNzU1IDQ3NC4xNDcgMzQ3LjIzIDQ3NC44MTlDMzQyLjA2NiA0NzUuMjA5IDMzNS4zNjEgNDc1LjAzMSAzMzAuMTE0IDQ3NS4wM0wzMDIuMTU3IDQ3NS4wMjVMMjEzLjQ5OCA0NzUuMDI1TDEzMy43NTUgNDc1LjAyNUwxMDguOTA2IDQ3NS4wMzZDMTAzLjAwNyA0NzUuMDM3IDk2Ljk4OCA0NzUuMTg3IDkxLjEyNTggNDc0LjY0Qzc5Ljc5MTEgNDczLjYzMiA2OC43MSA0NzAuNzA1IDU4LjM1NTcgNDY1Ljk4NUMzMi41MTM4IDQ1NC4xOTYgMTIuOTE5NCA0MzEuOTU0IDQuNDgwOTUgNDA0LjgzMkMzLjE2MTkzIDQwMC42MTUgMi4yODc1MyAzOTcuMTUgMS41MTk4NiAzOTIuNzk5QzEuMTA4ODggMzkwLjQ2OSAwLjc3MzI4MiAzODUuNDYgMCAzODMuNjZMMCAxMjYuNTcyWiIvPjxwYXRoIGZpbGw9IiMwMDAwMDAiIGQ9Ik0xODUuNjY4IDk4Ljg0NjZDMTg2LjkyMyA5OC42NDMyIDE5Mi4zMjggOTguNzEyOCAxOTMuNzQ5IDk4LjcxMjlMMjA5LjkzMyA5OC43MjM2TDI0My40MDQgOTguNzI3QzI1My4yOTMgOTguNzI0NSAyNjIuMjA0IDk4LjQ2IDI3Mi4wMzkgOTkuOTIyNUMyOTMuNDMxIDEwMy4xMDMgMzEzLjI2OCAxMTYuODA3IDMxOS4yODcgMTM4LjQ5M0MzMjAuNDk3IDE0My4wMjUgMzIxLjE1MiAxNDcuNjg4IDMyMS4yMzkgMTUyLjM3OEMzMjEuMzE5IDE1Ny45MTMgMzIwLjMwNSAxNjQuMDI5IDMxOS42MTMgMTY5LjVDMzE3Ljk0OCAxODIuNjY0IDMxNi41OSAxOTQuNjQ4IDMwOS44NDggMjA2LjQzMkMzMDAuNDU3IDIyMi44NDUgMjg4LjcwOSAyMzEuNSAyNzAuNzY4IDIzNi40OTNDMjczLjA3IDIzNi44ODIgMjc1LjMzMyAyMzcuNDc4IDI3Ny41MjggMjM4LjI3NEMyOTAuMzA1IDI0Mi44MjcgMjk5LjU2NyAyNTEuMjM1IDMwNS4zMjMgMjYzLjZDMzA3Ljk0IDI2OS4yMzggMzA5LjUwMyAyNzUuMzA2IDMwOS45MzQgMjgxLjUwNkMzMTAuNTM4IDI4OS4xOTIgMzA5LjQzNiAyOTUuNTM1IDMwOC40OTcgMzAzLjA4M0MzMDcuMTc0IDMxMy43MjggMzA2LjAxNSAzMjIuNDA0IDMwMi40MDUgMzMyLjU4MUMyOTYuMDQgMzUwLjUyNiAyODIuNTc5IDM2Ni4yOTYgMjY1LjE3NCAzNzQuMzc2QzI1OC44MjUgMzc3LjI5OSAyNTIuMTIzIDM3OS4zODMgMjQ1LjIzNyAzODAuNTc2QzIzMi4xMjUgMzgyLjkzIDIxNS4wNDQgMzgyLjE1NiAyMDEuNjAxIDM4MS45MDhDMTk0LjQyMSAzODEuNzc1IDE4Ny45OTcgMzc3Ljk5NSAxODUuMDI5IDM3MS4xOThDMTgzLjA4NCAzNjYuODE1IDE4My4wMjEgMzYxLjgyNiAxODQuODUzIDM1Ny4zOTRDMTg4LjcxMSAzNDcuOTMyIDE5NS4yNzYgMzQ2Ljg4OCAyMDQuMjEyIDM0Ni40ODNDMjE2LjQ0MSAzNDUuOTMgMjI5LjQ4MiAzNDcuNjY2IDI0MC45MjggMzQyLjY4OEMyNTIuMDI2IDMzNy44NjEgMjU5LjMxNSAzMjkuNDM0IDI2My43OTMgMzE4LjMxQzI2Ni4wODcgMzExLjUzMyAyNjYuNTM4IDMwNS42NTQgMjY3LjUwNCAyOTguNjU4QzI2OC4yMTMgMjkzLjc0NyAyNjguOTg4IDI4OC45NTQgMjY5LjEyIDI4My45OUMyNjkuNDk1IDI2OS44NTIgMjU5LjMyOCAyNTguODE2IDI0NS43MjEgMjU2LjE0MkMyMzcuMzU3IDI1NC40OTkgMjI4LjA0OSAyNTUuMDA1IDIxOS40MjcgMjU1LjAwMkwxODQuNDA0IDI1NC45OTFDMTgwLjE5NiAyODguMzQ3IDE3NC43NDQgMzIyLjIzMiAxNjkuOTg0IDM1NS41NTJMMTY0Ljg0MyAzOTEuODE1QzE2My45NDggMzk4LjIwOCAxNjMuMTQ1IDQwNC44NCAxNjEuOTkxIDQxMS4xODVDMTYxLjU2NyA0MTMuNTEyIDE1OS45MDMgNDE2LjYxMiAxNTguNDU1IDQxOC40ODFDMTU1LjA5NCA0MjIuODUzIDE1MC4xMjMgNDI1LjY5OCAxNDQuNjUgNDI2LjM4QzEzOS4yNTIgNDI2Ljk1NyAxMzMuODQ0IDQyNS4zNzMgMTI5LjYxIDQyMS45NzRDMTE5LjI4OCA0MTMuNjkzIDEyMi4zNTUgNDAzLjAwNyAxMjMuOTQxIDM5MS43MTdMMTI2Ljk4NSAzNzAuMTU0TDEzNi4zNjYgMzAwLjgzN0wxNTMuNjg5IDE3OC43NTdMMTU5LjA2MyAxNDEuMDA0QzE2MC4wNCAxMzQuMDUgMTYwLjkyNCAxMjcuMDQ5IDE2Mi4wNzggMTIwLjEyNUMxNjQuMDAzIDEwOC41NyAxNzQuMjY4IDEwMC4wNTMgMTg1LjY2OCA5OC44NDY2WiIvPjxwYXRoIGZpbGw9IiNGRkZGRkYiIGQ9Ik0yMDEuNDM4IDEzNC43MzZMMjMzLjM0NiAxMzQuNzQzQzI0Ny45NzIgMTM0Ljc0NiAyNjQuNDU0IDEzMy4yNDUgMjc0LjU2IDE0Ni4yNzdDMjgwLjM3NCAxNTMuNzc1IDI4MC40NTkgMTYyLjE2OCAyNzkuMjgyIDE3MS4xNTNDMjc2Ljg3NiAxODkuNTM0IDI3Ni4xNTEgMjAyLjUwMyAyNjAuMTQ4IDIxNC43MjdDMjQ3LjI5NCAyMjMuMTg0IDIzNy41MjcgMjIxLjc0MSAyMjMuMDgxIDIyMS43NDFMMTg5LjE2MiAyMjEuNzA2TDIwMS40MzggMTM0LjczNloiLz48L2c+PC9zdmc+Cg==';

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
          justifyContent: 'space-between',
          background: '#fafaf9',
          color: '#1c1917',
          fontFamily: 'sans-serif',
          padding: '72px 80px',
          position: 'relative',
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <img src={LOGO_DATA_URI} width={72} height={72} alt="" />
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#1c1917',
              display: 'flex',
            }}
          >
            Byoky
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

        {gift ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 28,
                lineHeight: 1,
              }}
            >
              <div
                style={{
                  fontSize: 220,
                  fontWeight: 800,
                  letterSpacing: '-0.05em',
                  color: '#FF4F00',
                  display: 'flex',
                }}
              >
                {formatTokens(gift.m)}
              </div>
              <div
                style={{
                  fontSize: 84,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  color: '#1c1917',
                  display: 'flex',
                }}
              >
                {gift.n} tokens
              </div>
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 500,
                color: '#57534e',
                marginTop: 6,
                display: 'flex',
              }}
            >
              from {gift.s}
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 100,
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
                fontSize: 100,
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
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {gift ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 20,
                fontSize: 28,
                fontWeight: 500,
                color: '#57534e',
              }}
            >
              <div style={{ display: 'flex' }}>{formatExpiry(gift.e)}</div>
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#a8a29e',
                  display: 'flex',
                }}
              />
              <div style={{ display: 'flex' }}>Open in Byoky to accept</div>
            </div>
          ) : (
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
          )}
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
    ),
    size,
  );
}
