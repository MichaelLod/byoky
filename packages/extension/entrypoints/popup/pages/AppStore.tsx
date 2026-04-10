import { useState, useEffect } from 'react';
import { useWalletStore } from '../store';
import type { MarketplaceApp } from '@byoky/core';

const MARKETPLACE_URL = 'https://byoky.com/api/apps';

export function AppStore() {
  const { navigate, installedApps, installApp } = useWalletStore();
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchApps() {
      try {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        const res = await fetch(`${MARKETPLACE_URL}/api/apps?${params}`);
        if (!res.ok) throw new Error('Failed to load apps');
        const data = await res.json();
        setApps(data.apps);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    const timeout = setTimeout(fetchApps, search ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [search]);

  const installedIds = new Set(installedApps.map((a) => a.id));

  return (
    <div>
      <div className="page-title-row">
        <button className="text-link" onClick={() => navigate('apps')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <h2 className="page-title" style={{ flex: 1, textAlign: 'center' }}>App Store</h2>
        <div style={{ width: 50 }} />
      </div>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search apps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && <div className="empty-state"><p>Loading...</p></div>}

      {error && <div className="error">{error}</div>}

      {!loading && !error && apps.length === 0 && (
        <div className="empty-state">
          <p>No apps found</p>
        </div>
      )}

      {apps.map((app) => {
        const installed = installedIds.has(app.id);
        return (
          <div key={app.id} className="card store-app-card">
            <div className="store-app-row">
              {app.icon ? (
                <img src={app.icon} alt={app.name} className="store-app-icon" />
              ) : (
                <div className="store-app-icon-placeholder">
                  {app.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="store-app-info">
                <div className="card-title">
                  {app.name}
                  {app.verified && <span className="badge badge-verified" title="Verified">Verified</span>}
                  {app.featured && <span className="badge badge-featured">Featured</span>}
                </div>
                <div className="card-subtitle">{app.author.name}</div>
                <p className="store-app-desc">{app.description}</p>
                <div className="store-app-providers">
                  {app.providers.map((p) => (
                    <span key={p} className="badge badge-provider">{p}</span>
                  ))}
                </div>
              </div>
            </div>
            <button
              className={`btn btn-sm ${installed ? 'btn-secondary' : 'btn-primary'}`}
              disabled={installed}
              onClick={() => installApp(app)}
            >
              {installed ? 'Installed' : 'Install'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
