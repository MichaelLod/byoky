'use client';

import { useState, useEffect } from 'react';
import { useVaultToken, vaultFetch } from '../wallet/use-vault';

interface App {
  id: string;
  name: string;
  discountPercent: number;
  totalUsers: number;
  category?: string;
  createdAt: number;
}

export default function DeveloperDashboard() {
  const { token, login, isLoggedIn } = useVaultToken();
  const [apps, setApps] = useState<App[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    vaultFetch('/developer/apps', token).then(r => r.json()).then(data => {
      setApps(((data as { apps: App[] }).apps) ?? []);
    }).catch(() => {});
  }, [token]);

  if (!isLoggedIn) {
    return (
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Developer Dashboard</h1>
        <p style={{ color: '#a1a1aa', marginBottom: '24px' }}>Sign in to manage your apps</p>
        {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
        <form onSubmit={async (e) => { e.preventDefault(); const ok = await login(username, password); if (!ok) setError('Invalid credentials'); }} style={{ maxWidth: '380px' }}>
          <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: '8px' }} />
          <button type="submit" style={{ marginTop: '12px', padding: '10px 20px', borderRadius: '10px', background: '#0ea5e9', color: '#fff', border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Sign In</button>
        </form>
      </div>
    );
  }

  const totalUsers = apps.reduce((sum, a) => sum + a.totalUsers, 0);

  return (
    <div>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Developer Dashboard</h1>
      <p style={{ color: '#a1a1aa', marginBottom: '32px' }}>Ship AI apps. Never pay an API bill.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Total Users" value={totalUsers.toLocaleString()} sub="across all apps" />
        <StatCard label="Apps" value={String(apps.length)} sub="registered" />
        <StatCard label="Status" value="Active" sub="all systems operational" />
      </div>

      {apps.length > 0 ? (
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>Your Apps</h2>
          {apps.map(app => (
            <a key={app.id} href={`/developer/apps/${app.id}`} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '12px', padding: '16px 20px', marginBottom: '8px', textDecoration: 'none', color: 'inherit',
            }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{app.name}</div>
                <div style={{ fontSize: '12px', color: '#71717a' }}>
                  {app.id} &middot; {app.discountPercent}% discount &middot; {app.totalUsers} users
                </div>
              </div>
              <span style={{ color: '#0ea5e9', fontSize: '14px' }}>Stats &rarr;</span>
            </a>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '32px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px' }}>
          <p style={{ color: '#71717a', marginBottom: '16px' }}>No apps registered yet</p>
          <a href="/developer/setup" style={{ padding: '10px 20px', borderRadius: '10px', background: '#0ea5e9', color: '#fff', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}>Get Started</a>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
        <a href="/developer/apps" style={{ ...linkBtn, background: '#0ea5e9', color: '#fff' }}>Manage Apps</a>
        <a href="/developer/setup" style={linkBtn}>Integration Guide</a>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px', padding: '20px',
    }}>
      <div style={{ fontSize: '12px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#52525b', marginTop: '4px' }}>{sub}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)', color: '#e4e4e7', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};
const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '10px',
  background: 'rgba(255,255,255,0.06)', color: '#e4e4e7', border: '1px solid rgba(255,255,255,0.1)',
  textDecoration: 'none', fontSize: '14px', fontWeight: 500,
};
