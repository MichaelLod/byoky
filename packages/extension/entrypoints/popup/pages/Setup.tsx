import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

type SetupMode = 'choose' | 'card' | 'byok';

export function Setup() {
  const { setup, enableCloudVault, error } = useWalletStore();
  const [mode, setMode] = useState<SetupMode>('choose');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [username, setUsername] = useState('');
  const [localError, setLocalError] = useState('');

  const strength = checkPasswordStrength(password);

  async function handleCardSetup(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (!username.trim()) {
      setLocalError('Username is required');
      return;
    }
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

    // Create local wallet + cloud vault account
    await setup(password);
    await enableCloudVault(username.trim().toLowerCase(), password, true);
  }

  function handleByokSetup(e: FormEvent) {
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

    setup(password);
  }

  const displayError = localError || error;

  // --- Choose mode ---
  if (mode === 'choose') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Your AI Wallet</div>

        <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button className="btn btn-primary" onClick={() => setMode('card')}>
            Get started
          </button>
          <button
            className="text-link"
            style={{ fontSize: '12px', marginTop: '8px' }}
            onClick={() => setMode('byok')}
          >
            Advanced: I have my own API keys
          </button>
        </div>
      </div>
    );
  }

  // --- Card-first setup (new default) ---
  if (mode === 'card') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Create your wallet</div>

        <form onSubmit={handleCardSetup}>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            One account, all your AI apps. Add a card later to start using AI.
          </p>

          {displayError && <div className="error">{displayError}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
              autoComplete="new-password"
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
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!username.trim() || password.length < MIN_PASSWORD_LENGTH || strength.score < 2}
          >
            Create Wallet
          </button>
        </form>

        <button className="text-link" style={{ fontSize: '12px', marginTop: '12px' }} onClick={() => setMode('choose')}>
          &larr; Back
        </button>
      </div>
    );
  }

  // --- BYOK setup (advanced) ---
  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">Bring Your Own Key</div>

      <form onSubmit={handleByokSetup}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
          Create a master password to encrypt your API keys locally.
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

      <button className="text-link" style={{ fontSize: '12px', marginTop: '12px' }} onClick={() => setMode('choose')}>
        &larr; Back
      </button>
    </div>
  );
}
