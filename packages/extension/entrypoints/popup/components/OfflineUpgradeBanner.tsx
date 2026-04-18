import { useWalletStore } from '../store';

const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function OfflineUpgradeBanner() {
  const {
    cloudVaultEnabled,
    vaultBannerDismissedAt,
    dismissVaultBanner,
    openSettingsCloudVault,
  } = useWalletStore();

  if (cloudVaultEnabled) return null;
  if (vaultBannerDismissedAt && Date.now() - vaultBannerDismissedAt < DISMISS_COOLDOWN_MS) return null;

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
        Turn on Cloud Sync to access your keys on any device. Encrypted with your password.
      </div>

      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: '12px', padding: '6px 12px' }}
        onClick={openSettingsCloudVault}
      >
        Activate Cloud Sync
      </button>
    </div>
  );
}
