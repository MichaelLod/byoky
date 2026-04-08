'use client';

import { useParams } from 'next/navigation';

export default function AppDetail() {
  const params = useParams();
  const appId = params.id as string;

  return (
    <div>
      <a href="/marketplace" style={{ color: '#71717a', textDecoration: 'none', fontSize: '14px' }}>
        &larr; Back to Marketplace
      </a>

      <div style={{ marginTop: '24px', marginBottom: '32px' }}>
        {/* App header */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', fontWeight: 700, color: '#fff',
          }}>
            ?
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '2px' }}>App Name</h1>
            <p style={{ color: '#71717a', fontSize: '14px' }}>
              <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>
                {appId}
              </code>
            </p>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Users', value: '—' },
            { label: 'Discount', value: '—' },
            { label: 'Category', value: '—' },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                {stat.label}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700 }}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Description */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '20px',
        }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>About</h2>
          <p style={{ color: '#a1a1aa', fontSize: '14px', lineHeight: 1.6 }}>
            App details loading...
          </p>
        </div>

        {/* How to use */}
        <div style={{
          marginTop: '16px',
          background: 'rgba(14, 165, 233, 0.06)',
          border: '1px solid rgba(14, 165, 233, 0.15)',
          borderRadius: '12px',
          padding: '20px',
        }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>How to use</h3>
          <p style={{ color: '#a1a1aa', fontSize: '13px', lineHeight: 1.6 }}>
            This app supports Byoky wallet. Click &ldquo;Pay with Byoky&rdquo; when prompted
            to use your wallet balance. No separate account or credit card needed.
          </p>
        </div>
      </div>
    </div>
  );
}
