import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { Raven } from '../components/Raven';

export function Unlock() {
  const { unlock, resetWallet, error } = useWalletStore();
  const [password, setPassword] = useState('');
  const [showReset, setShowReset] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    unlock(password);
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
            {error && <div className="error">{error}</div>}

            <div className="form-group">
              <label htmlFor="password">Master password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoFocus
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Unlock
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
