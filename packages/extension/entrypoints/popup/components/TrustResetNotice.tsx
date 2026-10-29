import { useEffect } from 'react';
import { useWalletStore } from '../store';

/**
 * Shown after the background dropped the trusted sites (and revocations)
 * because the stored list failed its integrity check. Like
 * RetiredFeaturesNotice, the first showing clears the stored flag, so it
 * stays up for this session only, until dismissed.
 */
export function TrustResetNotice() {
  const { showTrustResetNotice, dismissTrustResetNotice, markTrustResetNoticeSeen } = useWalletStore();

  useEffect(() => {
    if (showTrustResetNotice) markTrustResetNoticeSeen();
  }, [showTrustResetNotice, markTrustResetNoticeSeen]);

  if (!showTrustResetNotice) return null;

  return (
    <div className="notice notice-warning" role="status">
      <button
        type="button"
        aria-label="Dismiss"
        className="notice-dismiss"
        onClick={() => dismissTrustResetNotice()}
      >
        ×
      </button>

      <div className="notice-title">
        Trusted sites were reset
      </div>
      <div className="notice-text">
        The stored list failed its integrity check, so it was cleared. Sites you trusted will ask
        for approval again.
      </div>
    </div>
  );
}
