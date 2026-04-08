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
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    vaultFetch('/developer/apps', token).then(r => r.json()).then(data => {
      setApps(((data as { apps: App[] }).apps) ?? []);
    }).catch(() => {});
  }, [token]);

  const totalUsers = apps.reduce((sum, a) => sum + a.totalUsers, 0);

  return (
    <div>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>Developer Dashboard</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Ship AI apps. Never pay an API bill.
      </p>

      {/* Always-visible stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <StatCard label="Providers" value="15+" sub="supported out of the box" />
        <StatCard label="Integration" value="2 lines" sub="npm install + mount" />
        <StatCard label="Your cost" value="$0" sub="users pay from their wallet" />
      </div>

      {/* Quick actions — always visible */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
        <a href="/developer/setup" style={{ ...linkBtn, background: 'var(--teal)', color: '#fff', border: 'none' }}>Integration Guide</a>
        <a href="/developer/payouts" style={linkBtn}>Payouts &amp; Pricing</a>
        <a href="/demo/pay" style={linkBtn}>Live Demo</a>
      </div>

      {/* Your Apps — requires login */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Your Apps</h2>
          {!isLoggedIn && (
            <button onClick={() => setShowLogin(!showLogin)} style={{
              padding: '8px 16px', borderRadius: '8px', background: 'var(--teal)', color: '#fff',
              border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}>
              Sign in to manage apps
            </button>
          )}
        </div>

        {/* Login form — only shown when requested */}
        {showLogin && !isLoggedIn && (
          <div style={{ maxWidth: '380px', marginBottom: '16px', padding: '20px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
            {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
            <form onSubmit={async (e) => { e.preventDefault(); const ok = await login(username, password); if (!ok) setError('Invalid credentials'); else setShowLogin(false); }}>
              <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
              <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: '8px' }} />
              <button type="submit" style={{ marginTop: '12px', padding: '10px 20px', borderRadius: '10px', background: 'var(--teal)', color: '#fff', border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Sign In</button>
            </form>
          </div>
        )}

        {/* App list — shown when logged in */}
        {isLoggedIn && apps.length > 0 && (
          <div>
            {apps.map(app => (
              <a key={app.id} href={`/developer/apps/${app.id}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '16px 20px', marginBottom: '8px', textDecoration: 'none', color: 'inherit',
              }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{app.name}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {app.id} &middot; {app.discountPercent}% discount &middot; {app.totalUsers} users
                  </div>
                </div>
                <span style={{ color: 'var(--teal)', fontSize: '14px' }}>Stats &rarr;</span>
              </a>
            ))}
          </div>
        )}

        {isLoggedIn && apps.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px', background: 'var(--bg-surface)', border: '1px dashed var(--border)', borderRadius: '12px' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No apps registered yet</p>
            <a href="/developer/setup" style={{ color: 'var(--teal)', fontSize: '14px' }}>Get started with the SDK &rarr;</a>
          </div>
        )}

        {!isLoggedIn && !showLogin && (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Sign in to register apps, view analytics, and manage your API keys.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: '12px', padding: '20px',
    }}>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{sub}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
};
const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '10px',
  background: 'var(--bg-surface)', color: 'var(--text)', border: '1px solid var(--border)',
  textDecoration: 'none', fontSize: '14px', fontWeight: 500,
};
