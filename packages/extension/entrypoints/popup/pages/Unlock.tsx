import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';

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
      <div className="logo-large">Byoky</div>
      <div className="tagline">Welcome back</div>

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
            className="btn-link"
            style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}
            onClick={() => setShowReset(true)}
          >
            Forgot password?
          </button>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '0 8px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
            Reset Wallet?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            This will permanently delete all API keys, sessions, and settings. This cannot be undone.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              onClick={() => setShowReset(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1, background: 'var(--danger)', color: '#fff' }}
              onClick={() => resetWallet()}
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
