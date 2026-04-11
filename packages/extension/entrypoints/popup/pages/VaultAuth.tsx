import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function VaultAuth() {
  const { vaultBootstrapSignup, vaultBootstrapLogin, navigate, error, clearError, loading } = useWalletStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const strength = checkPasswordStrength(password);
  const mode: 'signup' | 'login' | 'unknown' =
    status === 'available' ? 'signup' : status === 'taken' ? 'login' : 'unknown';

  const checkUsername = useCallback((value: string) => {
    clearTimeout(checkTimer.current);
    const trimmed = value.toLowerCase().trim();
    if (!trimmed || trimmed.length < 3) {
      setStatus('idle');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(trimmed)) {
      setStatus('invalid');
      return;
    }
    setStatus('checking');
    checkTimer.current = setTimeout(async () => {
      const result = await sendInternal('cloudVaultCheckUsername', { username: trimmed });
      if (result.available) {
        setStatus('available');
      } else {
        setStatus(result.reason === 'invalid' ? 'invalid' : 'taken');
      }
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(checkTimer.current), []);

  function handleUsernameChange(value: string) {
    setUsername(value);
    clearError();
    checkUsername(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    clearError();
    if (!username || !password) return;
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH || strength.score < 2) return;
      await vaultBootstrapSignup(username.toLowerCase().trim(), password);
    } else if (mode === 'login') {
      await vaultBootstrapLogin(username.toLowerCase().trim(), password);
    }
  }

  const canSubmit =
    !loading &&
    username.length >= 3 &&
    password.length > 0 &&
    (mode === 'login' ||
      (mode === 'signup' && password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2));

  const buttonLabel =
    loading ? 'Connecting...'
      : status === 'checking' ? 'Checking username...'
      : mode === 'signup' ? 'Create account'
      : mode === 'login' ? 'Sign in'
      : 'Continue';

  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">Your vault, your keys</div>

      <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          End-to-end encrypted with your password.
          We can't read your keys.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label htmlFor="vault-username">Username</label>
          <input
            id="vault-username"
            type="text"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            placeholder="Choose or enter your username"
            autoComplete="username"
            autoFocus
          />
          {username.length >= 3 && (
            <p style={{
              fontSize: '11px',
              margin: '4px 0 0',
              color: status === 'available' ? 'var(--success, #4caf50)'
                : status === 'taken' ? 'var(--text-muted)'
                : status === 'invalid' ? 'var(--error, #ef4444)'
                : 'var(--text-muted)',
            }}>
              {status === 'checking' && 'Checking...'}
              {status === 'available' && 'Available — creating a new account'}
              {status === 'taken' && 'Existing account — signing in'}
              {status === 'invalid' && 'Letters, numbers, hyphens, underscores only (3-30 chars)'}
            </p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="vault-password">Password</label>
          <input
            id="vault-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'login' ? 'Your password' : 'At least 12 characters'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'signup' && password.length > 0 && <PasswordMeter strength={strength} />}
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!canSubmit}
        >
          {buttonLabel}
        </button>

        <button
          type="button"
          className="text-link"
          style={{
            display: 'block',
            width: '100%',
            marginTop: '12px',
            fontSize: '12px',
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={() => { clearError(); navigate('welcome'); }}
        >
          ← Back
        </button>
      </form>
    </div>
  );
}
