import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { Raven } from '../components/Raven';
import { useLockoutCountdown } from '../hooks/useLockoutCountdown';
import { FormError, LockoutEndedStatus, LockoutError } from '../components/FormError';
import { describeOrigin } from '../utils/origin';

export function Unlock() {
  const {
    unlock, resetWallet, error, submitting, lockedUntil, setLockedUntil, clearError, pendingApprovals,
  } = useWalletStore();
  const [password, setPassword] = useState('');
  const [showReset, setShowReset] = useState(false);
  // Set when a lockout ran out, for screen readers, until the next try.
  const [lockoutEnded, setLockoutEnded] = useState(false);
  // The background refuses every password until the lockout ends, so count
  // it down and offer the button again only then.
  const lockoutSeconds = useLockoutCountdown(lockedUntil, () => {
    setLockedUntil(null);
    clearError();
    setLockoutEnded(true);
  });
  const lockedOut = lockoutSeconds > 0;
  const hasError = lockedOut || !!error;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || submitting || lockedOut) return;
    setLockoutEnded(false);
    unlock(password);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setLockoutEnded(false);
    // "Incorrect password" is about the last try, not what is being typed.
    if (error && !lockedOut) clearError();
  }

  // An app asked to connect while the wallet was locked; it waits for this.
  const waiting = pendingApprovals[0];

  return (
    <div className="center-page">
      <div className="brand-mark">
        <Raven state={waiting ? 'alert' : 'watching'} size={showReset ? 150 : 220} />
      </div>
      <div className="status-line">Wallet locked</div>
      <h2 className="lock-title">Welcome back</h2>
      {waiting && (
        <p className="unlock-pending">
          {describeOrigin(waiting.appOrigin).label} wants to connect. Unlock to review.
          {pendingApprovals.length > 1 && ` (+${pendingApprovals.length - 1} more)`}
        </p>
      )}

      {!showReset ? (
        <>
          <form onSubmit={handleSubmit}>
            {lockedOut
              ? <LockoutError key={lockedUntil} id="unlock-error" seconds={lockoutSeconds} />
              : error && <FormError id="unlock-error">{error}</FormError>}
            <LockoutEndedStatus ended={lockoutEnded} />

            <div className="form-group">
              <label htmlFor="password">Master password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => handlePasswordChange(e.target.value)}
                placeholder="Enter your password"
                aria-invalid={hasError}
                aria-describedby={hasError ? 'unlock-error' : undefined}
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
