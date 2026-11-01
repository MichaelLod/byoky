import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { Raven } from '../components/Raven';
import { lockoutMessage, useLockoutCountdown } from '../hooks/useLockoutCountdown';

export function Unlock() {
  const { unlock, resetWallet, error, submitting, lockedUntil, setLockedUntil, clearError } = useWalletStore();
  const [password, setPassword] = useState('');
  const [showReset, setShowReset] = useState(false);
  // The background refuses every password until the lockout ends, so count
  // it down and offer the button again only then.
  const lockoutSeconds = useLockoutCountdown(lockedUntil, () => {
    setLockedUntil(null);
    clearError();
  });
  const lockedOut = lockoutSeconds > 0;
  const shownError = lockedOut ? lockoutMessage(lockoutSeconds) : error;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || submitting || lockedOut) return;
    unlock(password);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    // "Incorrect password" is about the last try, not what is being typed.
    if (error && !lockedOut) clearError();
  }

  return (
    <div className="center-page">
      <div className="brand-mark">
        <Raven state="watching" size={showReset ? 150 : 220} />
      </div>
      <div className="status-line">Wallet locked</div>
      <h2 className="lock-title">Welcome back</h2>

      {!showReset ? (
        <>
          <form onSubmit={handleSubmit}>
            {shownError && <div className="error">{shownError}</div>}

            <div className="form-group">
              <label htmlFor="password">Master password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder="Enter your password"
                autoFocus
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting || lockedOut}>
              {submitting ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>

          <button
            type="button"
            className="btn-link quiet-link"
            onClick={() => setShowReset(true)}
          >
            Forgot password?
          </button>
        </>
      ) : (
        <div className="center-body">
          <div className="dialog-title danger">
            Reset Wallet?
          </div>
          <div className="dialog-text">
            This will permanently delete all API keys, sessions, and settings. This cannot be undone.
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setShowReset(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => resetWallet()}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      <div className="lock-footer">
        <span>Keys stay on this device</span>
        <span>AES-256-GCM</span>
      </div>
    </div>
  );
}
