import { useWalletStore } from '../store';
import { PROVIDERS, isGiftExpired, giftBudgetRemaining, giftBudgetPercent } from '@byoky/core';
import { OfflineUpgradeBanner } from '../components/OfflineUpgradeBanner';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

export function Dashboard() {
  const {
    credentials, giftedCredentials, giftPreferences, giftPeerOnline,
    navigate, lock, removeCredential, removeGiftedCredential,
    setGiftPreference, cloudVaultEnabled, disableCloudVault,
  } = useWalletStore();
  const activeGifts = giftedCredentials.filter((gc) => !isGiftExpired(gc));
  const ownProviderIds = new Set(credentials.map((c) => c.providerId));
  const hasAny = credentials.length > 0 || activeGifts.length > 0;

  return (
    <div>
      <OfflineUpgradeBanner />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: cloudVaultEnabled ? 'var(--accent)' : 'var(--text-muted)' }}>Cloud Sync</span>
          <label className="toggle-switch" title={cloudVaultEnabled ? 'Cloud Sync on' : 'Cloud Sync off'}>
            <input
              type="checkbox"
              checked={cloudVaultEnabled}
              onChange={() => {
                if (cloudVaultEnabled) {
                  disableCloudVault();
                } else {
                  navigate('settings');
                }
              }}
            />
            <span className="toggle-slider" />
          </label>
          <button className="text-link" onClick={() => lock()}>
            Lock
          </button>
        </div>
      </div>

      {!hasAny ? (
        <div className="empty-state">
          <p>No API keys, tokens, or gifts yet.</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => navigate('add-credential')}
            >
              Add credential
            </button>
            <button
              className="btn btn-secondary"
              style={{ width: 'auto' }}
              onClick={() => navigate('redeem-gift')}
            >
              Redeem gift
            </button>
          </div>
        </div>
      ) : (
        <>
          {credentials.map((cred) => {
            const provider = PROVIDERS[cred.providerId];
            return (
              <div key={cred.id} className="card">
                <div className="card-header">
                  <span className="card-title">{cred.label}</span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeCredential(cred.id)}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <span className="badge badge-provider">
                    {provider?.name ?? cred.providerId}
                  </span>
                  <span className="badge badge-method">
                    {cred.authMethod === 'oauth' ? 'Setup Token' : 'API Key'}
                  </span>
                </div>
                <div className="card-subtitle" style={{ marginTop: '8px' }}>
                  Added {new Date(cred.createdAt).toLocaleDateString()}
                </div>
              </div>
            );
          })}

          {activeGifts.map((gc) => {
            const pct = giftBudgetPercent(gc);
            const remaining = giftBudgetRemaining(gc);
            const hasOwnKey = ownProviderIds.has(gc.providerId);
            const isPreferred = giftPreferences[gc.providerId] === gc.giftId;
            // peerOnline is populated asynchronously after refreshData;
            // undefined means "not yet probed" — render as checking so the
            // dot doesn't flash red before the probe lands.
            const onlineState = giftPeerOnline[gc.giftId];
            const dotClass = onlineState === true
              ? 'status-dot success'
              : onlineState === false
                ? 'status-dot error'
                : 'status-dot warning';
            const dotTitle = onlineState === true
              ? 'Sender online — gift can be used'
              : onlineState === false
                ? 'Sender offline — gift will fail until sender reconnects'
                : 'Checking sender status…';
            return (
              <div key={gc.id} className="card gift-card">
                <div className="card-header">
                  <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={dotClass} title={dotTitle} />
                    {gc.providerName}
                  </span>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => removeGiftedCredential(gc.id)}
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <span className="badge badge-provider">
                    {PROVIDERS[gc.providerId]?.name ?? gc.providerId}
                  </span>
                  <span className="badge badge-gift">Gift · from {gc.senderLabel}</span>
                </div>
                <div className="gift-budget" style={{ marginTop: '8px' }}>
                  <div className="gift-budget-text">
                    <span>{formatTokens(remaining)} remaining</span>
                    <span className="gift-budget-total">/ {formatTokens(gc.maxTokens)}</span>
                  </div>
                  <div className="allowance-bar">
                    <div
                      className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                {hasOwnKey && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={isPreferred}
                      onChange={() => setGiftPreference(gc.providerId, isPreferred ? null : gc.giftId)}
                      style={{ margin: 0 }}
                    />
                    Use instead of own key
                  </label>
                )}
                <div className="card-subtitle" style={{ marginTop: '6px' }}>
                  Expires in {formatExpiry(gc.expiresAt)}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => navigate('add-credential')}
            >
              Add credential
            </button>
            <button
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => navigate('redeem-gift')}
            >
              Redeem gift
            </button>
          </div>
        </>
      )}
    </div>
  );
}
