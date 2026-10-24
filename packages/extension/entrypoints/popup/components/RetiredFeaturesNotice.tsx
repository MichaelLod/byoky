import { useWalletStore } from '../store';

/**
 * One-time notice for users who relied on cloud sync or gifts before the
 * wallet became purely local. The background only raises the flag when its
 * upgrade cleanup found state from those features.
 */
export function RetiredFeaturesNotice() {
  const { showRetiredFeaturesNotice, dismissRetiredFeaturesNotice, navigate } = useWalletStore();

  if (!showRetiredFeaturesNotice) return null;

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
        onClick={() => dismissRetiredFeaturesNotice()}
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
        Byoky is now fully local
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: 1.5 }}>
        Cloud sync and gifts have been retired. Your keys on this device are untouched.
        To move keys to another device, use Export in Settings.
      </div>

      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: '12px', padding: '6px 12px' }}
        onClick={() => {
          dismissRetiredFeaturesNotice();
          navigate('settings');
        }}
      >
        Open Settings
      </button>
    </div>
  );
}
