import apps from '@/data/apps.json';

export default function Marketplace() {
  const approved = apps.filter((app) => app.status === 'approved');

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '80px 20px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>App Marketplace</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Apps that run on your own API keys</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {approved.map((app) => (
          <div key={app.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 4 }}>{app.name}</h3>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>{app.description}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>by {app.author.name}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
