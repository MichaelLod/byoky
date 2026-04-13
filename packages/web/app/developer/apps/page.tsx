'use client';

export default function DeveloperApps() {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700 }}>Your Apps</h1>
        <button
          style={{
            padding: '10px 20px', borderRadius: '10px',
            background: 'var(--teal)', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 500, cursor: 'pointer',
          }}
        >
          Register New App
        </button>
      </div>

      {/* Empty state */}
      <div style={{
        textAlign: 'center',
        padding: '48px 24px',
        background: 'var(--bg-surface)',
        border: '1px dashed var(--border)',
        borderRadius: '12px',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#128640;</div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>No apps yet</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
          Register your first app to get an API key and start integrating the Byoky SDK.
        </p>
        <a
          href="/developer/setup"
          style={{
            display: 'inline-flex', padding: '10px 20px', borderRadius: '10px',
            background: 'var(--teal)', color: '#fff', textDecoration: 'none',
            fontSize: '14px', fontWeight: 500,
          }}
        >
          Get Started
        </a>
      </div>

      {/* App list placeholder — populated when apps exist */}
      <div style={{ display: 'none', flexDirection: 'column', gap: '8px' }}>
        {/* Example app card structure */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px',
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>App Name</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              app_xxx &middot; 50% discount &middot; 0 users
            </div>
          </div>
          <a href="/developer/apps/app_xxx" style={{ color: 'var(--teal)', fontSize: '14px', textDecoration: 'none' }}>
            View Stats &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
