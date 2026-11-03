import { useWalletStore } from '../store';

/**
 * Shown while apps are paused because the wallet's groups and spending
 * limits, or its usage totals, failed their integrity check (the background
 * replaced them with a safe state: lib/routing-state.ts). Not dismissible:
 * it goes away once the user, having checked the limits, resumes apps.
 */
export function LimitsHoldNotice() {
  const { limitsHold, resumeApps, navigate, currentPage } = useWalletStore();

  if (!limitsHold) return null;

  // Connected Apps is the Connect tab's Sessions list, where this notice
  // also shows: there, the limits are right below it.
  const onConnectedApps = currentPage === 'connect' || currentPage === 'connected-apps';

  return (
    <div className="notice notice-warning" role="status">
      <div className="notice-title">
        Apps are paused
      </div>
      <div className="notice-text">
        {limitsHold === 'settings'
          ? 'Your groups and spending limits failed their integrity check, so groups were reset to the default. '
          : 'Your token usage totals failed their integrity check. '}
        Check each app&apos;s spending limit and usage under Connected Apps, then resume apps.
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {!onConnectedApps && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('connect')}>
            Check limits
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => resumeApps()}>
          Resume apps
        </button>
      </div>
    </div>
  );
}
