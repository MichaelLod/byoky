import apps from '@/data/apps.json';

export default function Home() {
  const approved = apps.filter((app) => app.status === 'approved');

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui' }}>
      <h1>Byoky Marketplace</h1>
      <p style={{ color: '#666' }}>Apps that run on your own API keys</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginTop: 32 }}>
        {approved.map((app) => (
          <div key={app.id} style={{ border: '1px solid #eee', borderRadius: 12, padding: 16 }}>
            <h3>{app.name}</h3>
            <p style={{ fontSize: 14, color: '#666' }}>{app.description}</p>
            <p style={{ fontSize: 12, color: '#999' }}>by {app.author.name}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
