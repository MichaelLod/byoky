'use client';

import { useParams } from 'next/navigation';

export default function AppDetail() {
  const params = useParams();
  const appId = params.id as string;

  return (
    <div>
      <a href="/developer/apps" style={{ color: '#71717a', textDecoration: 'none', fontSize: '14px' }}>
        &larr; Back to Apps
      </a>

      <div style={{ marginTop: '16px', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>App Analytics</h1>
        <p style={{ color: '#71717a', fontSize: '14px' }}>
          <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px', fontSize: '12px' }}>
            {appId}
          </code>
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {[
          { label: 'Unique Users', value: '—' },
          { label: 'Total Requests', value: '—' },
          { label: 'Input Tokens', value: '—' },
          { label: 'Output Tokens', value: '—' },
          { label: 'Total Revenue', value: '—' },
          { label: 'Discount Rate', value: '—' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              padding: '16px',
            }}
          >
            <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Settings */}
      <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Settings</h2>
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '12px',
        padding: '20px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: '2px' }}>API Key</div>
            <div style={{ fontSize: '12px', color: '#71717a' }}>Shown only once at creation. Rotate if compromised.</div>
          </div>
          <button
            style={{
              padding: '6px 14px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)', color: '#e4e4e7',
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: '13px', cursor: 'pointer',
            }}
          >
            Rotate Key
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: '2px' }}>Stripe Connect</div>
            <div style={{ fontSize: '12px', color: '#71717a' }}>Set up payouts to receive revenue share.</div>
          </div>
          <button
            style={{
              padding: '6px 14px', borderRadius: '8px',
              background: '#6366f1', color: '#fff', border: 'none',
              fontSize: '13px', cursor: 'pointer',
            }}
          >
            Set Up Payouts
          </button>
        </div>
      </div>
    </div>
  );
}
