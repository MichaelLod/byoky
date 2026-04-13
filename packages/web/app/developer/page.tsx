'use client';

import { useState, useEffect } from 'react';
import { useVaultToken, vaultFetch } from '../wallet/use-vault';
import { CodeExample } from '../demo/components/CodeExample';
import { CopySnippet } from '../components/CopySnippet';
import { VersionStatus } from '../components/VersionStatus';

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
      {/* Pay with Byoky preview */}
      <div style={{ textAlign: 'center', marginBottom: '32px', padding: '16px 0 32px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px' }}>Kill your API bill with two lines of code.</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', maxWidth: '500px', margin: '0 auto 24px' }}>
          Your users pay for their own AI. You keep building. Byoky handles the payments, the billing, and 15 providers.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
          <a
            href="/demo/pay"
            className="pay-btn-hover"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '10px',
              padding: '14px 28px', borderRadius: '12px',
              background: 'var(--teal)', color: '#fff',
              fontSize: '16px', fontWeight: 600,
              boxShadow: '0 4px 16px var(--teal-glow)',
              textDecoration: 'none',
              transition: 'all 0.2s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            Pay with Byoky — 50% off
          </a>
          {!isLoggedIn && (
            <button onClick={() => setShowLogin(!showLogin)} style={{
              padding: '14px 24px', borderRadius: '12px',
              background: 'var(--bg-surface)', color: 'var(--text)',
              border: '1px solid var(--border)',
              fontSize: '16px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s',
            }}>
              Developer Sign In
            </button>
          )}
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          This is the actual button your users see. <a href="/demo/pay" style={{ color: 'var(--teal)' }}>Try the live demo &rarr;</a>
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
          <CopySnippet text="npm install @byoky/sdk" display="npm install @byoky/sdk" />
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          or <code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal)', fontSize: '11px' }}>npx create-byoky-app</code> to scaffold a new project
        </p>
        <div style={{ marginTop: '24px' }}>
          <VersionStatus />
        </div>
      </div>

      {/* What you can build — interactive code examples */}
      <div style={{ marginBottom: '32px' }} className="demo-app dev-code-example">
        <CodeExample />
      </div>

      {/* Login form — shown when sign in clicked */}
      {showLogin && !isLoggedIn && (
        <div style={{ maxWidth: '380px', marginBottom: '32px', padding: '20px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border)' }}>
          {error && <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{error}</div>}
          <form onSubmit={async (e) => { e.preventDefault(); const ok = await login(username, password); if (!ok) setError('Invalid credentials'); else setShowLogin(false); }}>
            <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inputStyle, marginTop: '8px' }} />
            <button type="submit" style={{ marginTop: '12px', padding: '10px 20px', borderRadius: '10px', background: 'var(--teal)', color: '#fff', border: 'none', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Sign In</button>
          </form>
        </div>
      )}

      {/* Your Apps — only shown when logged in */}
      {isLoggedIn && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Your Apps</h2>
          {apps.length > 0 ? (
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
          ) : (
            <div style={{ textAlign: 'center', padding: '24px', background: 'var(--bg-surface)', border: '1px dashed var(--border)', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '12px' }}>No apps registered yet</p>
              <a href="/developer/setup" style={{ color: 'var(--teal)', fontSize: '14px' }}>Get started with the SDK &rarr;</a>
            </div>
          )}
        </div>
      )}
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
