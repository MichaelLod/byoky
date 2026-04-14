import { useState } from 'react';
import { useWalletStore } from '../store';

const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function OfflineUpgradeBanner() {
  const {
    cloudVaultEnabled,
    vaultBannerDismissedAt,
    dismissVaultBanner,
    vaultActivate,
    loading,
  } = useWalletStore();

  const [expanded, setExpanded] = useState(false);
  const [username, setUsername] = useState('');

  if (cloudVaultEnabled) return null;
  if (vaultBannerDismissedAt && Date.now() - vaultBannerDismissedAt < DISMISS_COOLDOWN_MS) return null;

  async function handleActivate() {
    if (!username.trim()) return;
    await vaultActivate(username.toLowerCase().trim());
    if (useWalletStore.getState().cloudVaultEnabled) {
      setExpanded(false);
      setUsername('');
    }
  }

  return (
    <div
      style={{
        background: 'var(--accent-bg, rgba(99, 102, 241, 0.08))',
        border: '1px solid var(--accent, #6366f1)',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '16px',
        position: 'relative',
      }}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissVaultBanner()}
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '4px 8px',
        }}
      >
        ×
      </button>

      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
        Sync across devices
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
        Turn on Cloud Sync to access your keys on any device, end-to-end encrypted.
      </div>

      {!expanded ? (
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={() => setExpanded(true)}
        >
          Activate Cloud Sync
        </button>
      ) : (
        <div style={{ marginTop: '8px' }}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a username"
            autoFocus
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '12px',
              marginBottom: '8px',
              background: 'var(--input-bg, #1a1a1a)',
              border: '1px solid var(--border, #333)',
              borderRadius: '4px',
              color: 'var(--text, #fff)',
            }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '6px 12px', flex: 1 }}
              disabled={loading || !username.trim()}
              onClick={handleActivate}
            >
              {loading ? 'Activating...' : 'Activate'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
              onClick={() => { setExpanded(false); setUsername(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
