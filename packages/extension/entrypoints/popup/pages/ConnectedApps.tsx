import { useState } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, isGiftExpired, type TokenAllowance } from '@byoky/core';

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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ConnectedApps() {
  const {
    sessions, revokeSession, trustedSites, removeTrustedSite,
    requestLog, tokenAllowances, setAllowance, removeAllowance,
    giftedCredentials, cloudVaultEnabled,
  } = useWalletStore();
  const activeGiftProviders = new Set(
    giftedCredentials.filter((gc) => !isGiftExpired(gc) && gc.usedTokens < gc.maxTokens).map((gc) => gc.providerId),
  );
  const [editingOrigin, setEditingOrigin] = useState<string | null>(null);

  function getOriginUsage(origin: string) {
    const entries = requestLog.filter((e) => e.appOrigin === origin && e.status < 400);
    let total = 0;
    const byProvider: Record<string, number> = {};
    for (const entry of entries) {
      const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
      total += tokens;
      byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
    }
    return { total, byProvider };
  }

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

      {sessions.length > 0 && !cloudVaultEnabled && (
        <div className="warning-box" style={{ marginBottom: '12px' }}>
          <strong>Device must stay online.</strong> Connected apps can only make
          requests while your browser is running and this extension is active.
          Enable Cloud Vault in Settings for offline access.
        </div>
      )}

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

      {sessions.map((session) => {
        const usage = getOriginUsage(session.appOrigin);
        const allowance = tokenAllowances.find((a) => a.origin === session.appOrigin);
        const isEditing = editingOrigin === session.appOrigin;
        const pct = allowance?.totalLimit ? Math.min(100, (usage.total / allowance.totalLimit) * 100) : 0;
        const isOver = allowance?.totalLimit != null && usage.total >= allowance.totalLimit;

        return (
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
                  const isGift = p.giftId || activeGiftProviders.has(p.providerId);
                  return (
                    <span key={p.providerId} className={`badge badge-provider${isGift ? ' badge-gift-provider' : ''}`}>
                      {provider?.name ?? p.providerId}
                      {isGift && <span className="gift-indicator"> (gift)</span>}
                    </span>
                  );
                })}
            </div>

            {/* Token usage & allowance */}
            <div className="allowance-section">
              <div className="allowance-usage-row">
                <span className="allowance-used">{formatTokens(usage.total)} tokens used</span>
                {allowance?.totalLimit != null && (
                  <span className={`allowance-limit ${isOver ? 'over' : ''}`}>
                    / {formatTokens(allowance.totalLimit)}
                  </span>
                )}
                <button
                  className="text-link allowance-edit-btn"
                  onClick={() => setEditingOrigin(isEditing ? null : session.appOrigin)}
                >
                  {allowance ? 'Edit limit' : 'Set limit'}
                </button>
              </div>
              {allowance?.totalLimit != null && (
                <div className="allowance-bar">
                  <div
                    className={`allowance-bar-fill ${isOver ? 'over' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>

            {isEditing && (
              <AllowanceForm
                origin={session.appOrigin}
                providers={session.providers.filter((p) => p.available).map((p) => p.providerId)}
                allowance={allowance}
                onSave={(a) => { setAllowance(a); setEditingOrigin(null); }}
                onRemove={() => { removeAllowance(session.appOrigin); setEditingOrigin(null); }}
                onCancel={() => setEditingOrigin(null)}
              />
            )}

            <div className="connected-meta">
              <span>{session.appOrigin}</span>
            </div>
          </div>
        );
      })}

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
              {site.allowedProviders && site.allowedProviders.length > 0 && (
                <div className="connected-providers" style={{ marginTop: '8px' }}>
                  {site.allowedProviders.map((id: string) => (
                    <span key={id} className="badge badge-provider">
                      {PROVIDERS[id]?.name ?? id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AllowanceForm({
  origin,
  providers,
  allowance,
  onSave,
  onRemove,
  onCancel,
}: {
  origin: string;
  providers: string[];
  allowance?: TokenAllowance;
  onSave: (a: TokenAllowance) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [totalLimit, setTotalLimit] = useState(
    allowance?.totalLimit != null ? String(allowance.totalLimit) : '',
  );
  const [providerLimits, setProviderLimits] = useState<Record<string, string>>(
    Object.fromEntries(
      providers.map((id) => [id, allowance?.providerLimits?.[id] != null ? String(allowance.providerLimits[id]) : '']),
    ),
  );

  function handleSave() {
    const parsed: TokenAllowance = { origin };
    const total = parseInt(totalLimit, 10);
    if (!isNaN(total) && total > 0) parsed.totalLimit = total;

    const pLimits: Record<string, number> = {};
    for (const [id, val] of Object.entries(providerLimits)) {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) pLimits[id] = n;
    }
    if (Object.keys(pLimits).length > 0) parsed.providerLimits = pLimits;

    onSave(parsed);
  }

  return (
    <div className="allowance-form">
      <div className="allowance-field">
        <label>Total token limit</label>
        <input
          type="number"
          placeholder="Unlimited"
          value={totalLimit}
          onChange={(e) => setTotalLimit(e.target.value)}
          min="0"
        />
      </div>
      {providers.length > 0 && (
        <div className="allowance-provider-limits">
          <label className="allowance-sub-label">Per provider</label>
          {providers.map((id) => (
            <div key={id} className="allowance-field allowance-field-inline">
              <span className="allowance-provider-name">{PROVIDERS[id]?.name ?? id}</span>
              <input
                type="number"
                placeholder="Unlimited"
                value={providerLimits[id] ?? ''}
                onChange={(e) => setProviderLimits({ ...providerLimits, [id]: e.target.value })}
                min="0"
              />
            </div>
          ))}
        </div>
      )}
      <div className="allowance-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        {allowance && (
          <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove limit</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
