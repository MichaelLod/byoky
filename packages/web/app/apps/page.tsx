import { listApps } from '@/lib/apps-db';

// Server component — query the DB directly and render. Revalidates every
// 60s so approvals appear without redeploys but we don't hit Postgres per
// page view.
export const revalidate = 60;

export default async function Apps() {
  let approved: Awaited<ReturnType<typeof listApps>> = [];
  try {
    approved = await listApps({});
  } catch {
    // If the DB is unreachable, render an empty grid rather than a 500.
  }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '120px 20px 80px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Apps</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Apps that run on your own API keys</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {approved.map((row) => (
          <div key={row.slug} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 4 }}>{row.payload.name}</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>{row.payload.description}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>by {row.payload.author?.name ?? 'Unknown'}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
