import { useState, type FormEvent } from 'react';
import { useWalletStore, setSessionPassword } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

export function Setup() {
  const { setup, error } = useWalletStore();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');

  const strength = checkPasswordStrength(password);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (strength.score < 2) {
      setLocalError('Password is too weak. ' + (strength.feedback[0] || ''));
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
            placeholder="At least 12 characters"
            autoFocus
          />
          {password.length > 0 && <PasswordMeter strength={strength} />}
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

        <button
          type="submit"
          className="btn btn-primary"
          disabled={password.length < MIN_PASSWORD_LENGTH || strength.score < 2}
        >
          Create Wallet
        </button>
      </form>

      <div className="mascot-peek">
        <img src="/mascot.svg" alt="" />
      </div>
    </div>
  );
}
