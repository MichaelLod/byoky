'use client';

export default function DeveloperDashboard() {
  return (
    <div>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>
        Developer Dashboard
      </h1>
      <p style={{ color: '#a1a1aa', marginBottom: '32px' }}>
        Ship AI apps. Never pay an API bill.
      </p>

      {/* Metrics cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: 'Total Users', value: '—', sub: 'across all apps' },
          { label: 'Requests (30d)', value: '—', sub: 'API calls proxied' },
          { label: 'Revenue (30d)', value: '—', sub: 'from Byoky flow' },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ fontSize: '12px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700 }}>{stat.value}</div>
            <div style={{ fontSize: '12px', color: '#52525b', marginTop: '4px' }}>{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <a
          href="/developer/apps"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '10px',
            background: '#0ea5e9', color: '#fff', textDecoration: 'none',
            fontSize: '14px', fontWeight: 500,
          }}
        >
          Manage Apps
        </a>
        <a
          href="/developer/setup"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 20px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.06)', color: '#e4e4e7',
            border: '1px solid rgba(255,255,255,0.1)', textDecoration: 'none',
            fontSize: '14px', fontWeight: 500,
          }}
        >
          Integration Guide
        </a>
      </div>
    </div>
  );
}
