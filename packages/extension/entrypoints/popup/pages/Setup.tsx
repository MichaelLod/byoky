import { useState, type FormEvent } from 'react';
import { useWalletStore, setSessionPassword } from '../store';

export function Setup() {
  const { setup, error } = useWalletStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setLocalError('Passwords do not match');
      return;
    }

    setSessionPassword(password);
    setup(password);
  }

  const displayError = localError || error;

  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">Bring Your Own Key</div>

      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          Create a master password to encrypt your API keys.
        </p>

        {displayError && <div className="error">{displayError}</div>}

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
          />
        </div>

        <button type="submit" className="btn btn-primary">
          Create Wallet
        </button>
      </form>

      <div className="mascot-peek">
        <img src="/mascot.svg" alt="" />
      </div>
    </div>
  );
}
