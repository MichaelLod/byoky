'use client';

import { useState, useEffect, useCallback } from 'react';

interface AppEntry {
  id: string;
  name: string;
  slug: string;
  url: string;
  description: string;
  category: string;
  providers: string[];
  author: { name: string; email?: string; website?: string };
  status: string;
  verified: boolean;
  featured: boolean;
  submittedAt?: number;
}

export default function AdminPage() {
  const [submissions, setSubmissions] = useState<AppEntry[]>([]);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const [subRes, appRes] = await Promise.all([
        fetch('/api/apps/admin/submissions', { headers: authHeaders }),
        fetch('/api/apps/apps'),
      ]);
      if (subRes.status === 401) { setAuthed(false); return; }
      if (subRes.ok) {
        const data = await subRes.json();
        setSubmissions(data.submissions ?? []);
      }
      if (appRes.ok) {
        const data = await appRes.json();
        setApps(data.apps ?? []);
      }
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => { if (authed) load(); }, [load, authed]);

  async function handleAction(slug: string, action: 'approve' | 'reject') {
    await fetch('/api/apps/admin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ slug, action }),
    });
    load();
  }

  if (!authed) {
    return (
      <main style={{ maxWidth: 400, margin: '0 auto', padding: '80px 20px', fontFamily: 'system-ui' }}>
        <h1>Admin Login</h1>
        <form onSubmit={(e) => { e.preventDefault(); setAuthed(true); }} style={{ marginTop: 24 }}>
          <input
            type="password"
            placeholder="Admin secret"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', fontSize: 16, borderRadius: 6, border: '1px solid #ccc' }}
          />
          <button
            type="submit"
            style={{ marginTop: 12, padding: '8px 24px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Login
          </button>
        </form>
      </main>
    );
  }

  const pending = submissions.filter((s) => s.status === 'pending');

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui' }}>
      <h1>Marketplace Admin</h1>

      <section style={{ marginTop: 32 }}>
        <h2>Pending Submissions ({pending.length})</h2>
        {pending.length === 0 && <p style={{ color: '#999' }}>No pending submissions.</p>}
        {pending.map((app) => (
          <div key={app.slug} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginTop: 12 }}>
            <h3>{app.name} <span style={{ fontSize: 12, color: '#999' }}>({app.slug})</span></h3>
            <p style={{ fontSize: 14, color: '#666' }}>{app.description}</p>
            <p style={{ fontSize: 12, color: '#999' }}>
              URL: <a href={app.url} target="_blank" rel="noopener">{app.url}</a> |
              Author: {app.author.name} ({app.author.email}) |
              Providers: {app.providers.join(', ')}
            </p>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleAction(app.slug, 'approve')}
                style={{ padding: '6px 16px', background: '#34d399', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Approve
              </button>
              <button
                onClick={() => handleAction(app.slug, 'reject')}
                style={{ padding: '6px 16px', background: '#f43f5e', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Approved Apps ({apps.length})</h2>
        {apps.map((app) => (
          <div key={app.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16, marginTop: 12 }}>
            <h3>
              {app.name}
              {app.verified && <span style={{ fontSize: 11, color: '#34d399', marginLeft: 6 }}>Verified</span>}
              {app.featured && <span style={{ fontSize: 11, color: '#fbbf24', marginLeft: 6 }}>Featured</span>}
            </h3>
            <p style={{ fontSize: 14, color: '#666' }}>{app.description}</p>
            <p style={{ fontSize: 12, color: '#999' }}>
              {app.url} | {app.providers.join(', ')}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
