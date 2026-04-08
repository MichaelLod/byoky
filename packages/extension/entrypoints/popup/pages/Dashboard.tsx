import { useState, useEffect } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, isGiftExpired, giftBudgetRemaining, giftBudgetPercent } from '@byoky/core';
import { BalanceCard } from '../components/BalanceCard';

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
    credentials, giftedCredentials, giftPreferences, navigate, lock,
    removeCredential, setGiftPreference, cloudVaultEnabled, disableCloudVault,
    balance, fetchBalance, sessions,
  } = useWalletStore();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const activeGifts = giftedCredentials.filter((gc) => !isGiftExpired(gc));
  const ownProviderIds = new Set(credentials.map((c) => c.providerId));

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '12px', color: cloudVaultEnabled ? 'var(--accent)' : 'var(--text-muted)' }}>Vault</span>
          <label className="toggle-switch" title={cloudVaultEnabled ? 'Cloud Vault on' : 'Cloud Vault off'}>
            <input
              type="checkbox"
              checked={cloudVaultEnabled}
              onChange={() => {
                if (cloudVaultEnabled) disableCloudVault();
                else navigate('settings');
              }}
            />
            <span className="toggle-slider" />
          </label>
        </div>
        <button className="text-link" onClick={() => lock()}>Lock</button>
      </div>

      {/* Balance Card — primary element */}
      <BalanceCard
        balance={balance}
        onAddFunds={() => navigate('add-funds')}
        onViewDetails={() => navigate('balance')}
      />

      {/* Connected apps summary */}
      {sessions.length > 0 && (
        <button
          className="card"
          style={{
            marginTop: '8px', width: '100%', textAlign: 'left', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            border: '1px solid var(--border)', background: 'var(--bg-secondary)',
          }}
          onClick={() => navigate('connected-apps')}
        >
          <span style={{ fontSize: '13px' }}>
            {sessions.length} connected app{sessions.length !== 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>&rarr;</span>
        </button>
      )}

      {/* Active gifts */}
      {activeGifts.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
              Active Gifts
            </h3>
            <button className="text-link" onClick={() => navigate('gifts')}>Manage</button>
          </div>
          {activeGifts.map((gc) => {
            const pct = giftBudgetPercent(gc);
            const remaining = giftBudgetRemaining(gc);
            const hasOwnKey = ownProviderIds.has(gc.providerId);
            const isPreferred = giftPreferences[gc.providerId] === gc.giftId;
            return (
              <div key={gc.id} className="card gift-card">
                <div className="card-header">
                  <span className="card-title">{gc.providerName}</span>
                  <span className="badge badge-gift">Gift</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <span className="badge badge-provider">from {gc.senderLabel}</span>
                </div>
                <div className="gift-budget" style={{ marginTop: '8px' }}>
                  <div className="gift-budget-text">
                    <span>{formatTokens(remaining)} remaining</span>
                    <span className="gift-budget-total">/ {formatTokens(gc.maxTokens)}</span>
                  </div>
                  <div className="allowance-bar">
                    <div className={`allowance-bar-fill ${pct >= 90 ? 'over' : ''}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                {hasOwnKey && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={isPreferred} onChange={() => setGiftPreference(gc.providerId, isPreferred ? null : gc.giftId)} style={{ margin: 0 }} />
                    Use instead of own key
                  </label>
                )}
                <div className="card-subtitle" style={{ marginTop: '6px' }}>Expires in {formatExpiry(gc.expiresAt)}</div>
              </div>
            );
          })}
        </>
      )}

      {/* Advanced: API Keys (collapsed) */}
      <div style={{ marginTop: '20px' }}>
        <button
          className="text-link"
          style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)', transition: '0.15s', display: 'inline-block' }}>&#9654;</span>
          Advanced: API Keys ({credentials.length})
        </button>

        {showAdvanced && (
          <div style={{ marginTop: '8px' }}>
            {credentials.length === 0 ? (
              <div className="empty-state">
                <p>No API keys. Use your balance instead, or add your own key for direct access.</p>
              </div>
            ) : (
              credentials.map((cred) => {
                const provider = PROVIDERS[cred.providerId];
                return (
                  <div key={cred.id} className="card">
                    <div className="card-header">
                      <span className="card-title">{cred.label}</span>
                      <button className="btn btn-danger btn-sm" onClick={() => removeCredential(cred.id)}>Remove</button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <span className="badge badge-provider">{provider?.name ?? cred.providerId}</span>
                      <span className="badge badge-method">{cred.authMethod === 'oauth' ? 'Setup Token' : 'API Key'}</span>
                    </div>
                  </div>
                );
              })
            )}
            <button className="btn btn-secondary" style={{ marginTop: '8px' }} onClick={() => navigate('add-credential')}>
              Add API key
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
