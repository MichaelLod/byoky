import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export function ConnectedApps() {
  const { sessions, revokeSession, trustedSites, removeTrustedSite } = useWalletStore();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Connected Apps</h2>
        {sessions.length > 1 && (
          <button
            className="text-link"
            style={{ color: 'var(--danger)', fontSize: '12px' }}
            onClick={() => sessions.forEach((s) => revokeSession(s.id))}
          >
            Disconnect all
          </button>
        )}
      </div>

      {sessions.length === 0 && trustedSites.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
            </svg>
          </div>
          <p>No apps connected</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 0 }}>
            When a site requests access to your wallet, it will appear here.
          </p>
        </div>
      )}

      {sessions.map((session) => (
        <div key={session.id} className="card connected-app-card">
          <div className="card-header" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div className="app-favicon">
                {formatOrigin(session.appOrigin).charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatOrigin(session.appOrigin)}
                </span>
                <div className="card-subtitle">
                  Connected {timeAgo(session.createdAt)}
                </div>
              </div>
            </div>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => revokeSession(session.id)}
            >
              Disconnect
            </button>
          </div>

          <div className="connected-providers">
            {session.providers
              .filter((p) => p.available)
              .map((p) => {
                const provider = PROVIDERS[p.providerId];
                return (
                  <span key={p.providerId} className="badge badge-provider">
                    {provider?.name ?? p.providerId}
                  </span>
                );
              })}
          </div>

          <div className="connected-meta">
            <span>{session.appOrigin}</span>
          </div>
        </div>
      ))}

      {trustedSites.length > 0 && (
        <div style={{ marginTop: sessions.length > 0 ? '24px' : '0' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Trusted Sites
          </h3>
          <p className="card-subtitle" style={{ marginBottom: '12px' }}>
            These sites connect without asking for approval.
          </p>
          {trustedSites.map((site) => (
            <div key={site.origin} className="card">
              <div className="card-header">
                <div style={{ minWidth: 0 }}>
                  <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatOrigin(site.origin)}
                  </span>
                  <div className="card-subtitle">
                    Trusted {timeAgo(site.trustedAt)}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeTrustedSite(site.origin)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
