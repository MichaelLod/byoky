import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Redeem Gift',
  description:
    'Redeem a Byoky token gift. Open this link in the Byoky extension or mobile app to accept shared token access.',
  alternates: {
    canonical: '/gift',
  },
};

export default function GiftPage() {
  return (
    <div
      className="container"
      style={{
        paddingTop: '80px',
        paddingBottom: '80px',
        maxWidth: '560px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--teal)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block' }}
        >
          <path d="M20 12v10H4V12" />
          <path d="M2 7h20v5H2z" />
          <path d="M12 22V7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      </div>

      <h1 style={{ fontSize: '28px', marginBottom: '8px' }}>Token Gift</h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          marginBottom: '32px',
          fontSize: '15px',
          lineHeight: 1.6,
        }}
      >
        Someone shared token access with you via Byoky.
      </p>

      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
          textAlign: 'left',
        }}
      >
        <h2
          style={{
            fontSize: '16px',
            marginBottom: '16px',
            color: 'var(--text)',
          }}
        >
          How to redeem
        </h2>
        <ol
          style={{
            color: 'var(--text-secondary)',
            fontSize: '14px',
            lineHeight: 1.8,
            paddingLeft: '20px',
            margin: 0,
          }}
        >
          <li>
            Copy the full URL from your browser&apos;s address bar
          </li>
          <li>
            Open the Byoky extension or mobile app
          </li>
          <li>
            Go to <strong style={{ color: 'var(--text)' }}>Gifts</strong>{' '}
            &rarr;{' '}
            <strong style={{ color: 'var(--text)' }}>Redeem Gift</strong>
          </li>
          <li>Paste the link and accept</li>
        </ol>
      </div>

      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: '12px',
          lineHeight: 1.6,
        }}
      >
        The gift payload is in the URL fragment (#) and is never sent to our
        server. Your token access is end-to-end between sender and recipient.
      </p>
    </div>
  );
}
