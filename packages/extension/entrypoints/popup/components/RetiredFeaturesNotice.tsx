import { useEffect } from 'react';
import { useWalletStore } from '../store';

/**
 * One-time notice for users who relied on cloud sync or gifts before the
 * wallet became purely local. The background only raises the flag when its
 * upgrade cleanup found state from those features; the first time the notice
 * is shown the flag is cleared, so it stays up for this session only.
 */
export function RetiredFeaturesNotice() {
  const { showRetiredFeaturesNotice, dismissRetiredFeaturesNotice, markRetiredFeaturesNoticeSeen, navigate } =
    useWalletStore();

  useEffect(() => {
    if (showRetiredFeaturesNotice) markRetiredFeaturesNoticeSeen();
  }, [showRetiredFeaturesNotice, markRetiredFeaturesNoticeSeen]);

  if (!showRetiredFeaturesNotice) return null;

  return (
    <div className="notice">
      <button
        type="button"
        aria-label="Dismiss"
        className="notice-dismiss"
        onClick={() => dismissRetiredFeaturesNotice()}
      >
        ×
      </button>

      <div className="notice-title">
        Byoky is now fully local
      </div>
      <div className="notice-text">
        Cloud sync and gifts have been retired. Your keys on this device are untouched.
        To move keys to another device, use Export in Settings.
      </div>

      <button
        type="button"
        className="btn btn-primary btn-sm"
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
