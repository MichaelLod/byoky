import { useState } from 'react';
import { useWalletStore } from '../store';
import { PROVIDERS, isGiftExpired, giftBudgetRemaining, giftBudgetPercent } from '@byoky/core';

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
  const { credentials, giftedCredentials, navigate, lock, removeCredential, cloudVaultEnabled, disableCloudVault } = useWalletStore();
  const [showVaultWarning, setShowVaultWarning] = useState(false);
  const activeGifts = giftedCredentials.filter((gc) => !isGiftExpired(gc));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Credentials</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label className="toggle-switch" title={cloudVaultEnabled ? 'Cloud Vault on' : 'Cloud Vault off'}>
            <input
              type="checkbox"
              checked={cloudVaultEnabled}
              onChange={() => {
                if (cloudVaultEnabled) {
                  disableCloudVault();
                } else {
                  setShowVaultWarning(true);
                }
              }}
            />
            <span className="toggle-slider" />
          </label>
          <span style={{ color: cloudVaultEnabled ? 'var(--accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            {cloudVaultEnabled ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            )}
          </span>
          <button className="text-link" onClick={() => lock()}>
            Lock
          </button>
        </div>
      </div>

      {showVaultWarning && (
        <div className="vault-warning-modal">
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Enable Cloud Vault to let websites use your credentials even when this device is offline.
            Your keys will be encrypted and stored on vault.byoky.com.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1 }}
              onClick={() => setShowVaultWarning(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={() => { setShowVaultWarning(false); navigate('settings'); }}
            >
              Set Up
            </button>
          </div>
        </div>
      )}

      {credentials.length === 0 ? (
        <div className="empty-state">
          <p>No API keys or tokens yet.</p>
          <button
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={() => navigate('add-credential')}
          >
            Add credential
          </button>
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

          <button
            className="btn btn-secondary"
            style={{ marginTop: '8px' }}
            onClick={() => navigate('add-credential')}
          >
            Add credential
          </button>
        </>
      )}

      {activeGifts.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
              Active Gifts
            </h3>
            <button className="text-link" onClick={() => navigate('gifts')}>
              Manage
            </button>
          </div>
          {activeGifts.map((gc) => {
            const pct = giftBudgetPercent(gc);
            const remaining = giftBudgetRemaining(gc);
            return (
              <div key={gc.id} className="card gift-card">
                <div className="card-header">
                  <span className="card-title">{gc.providerName}</span>
                  <span className="badge badge-gift">Gift</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <span className="badge badge-provider">
                    from {gc.senderLabel}
                  </span>
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
                <div className="card-subtitle" style={{ marginTop: '6px' }}>
                  Expires in {formatExpiry(gc.expiresAt)}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
