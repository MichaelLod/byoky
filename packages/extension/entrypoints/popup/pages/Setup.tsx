import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
type Mode = 'vault' | 'byok';
type Step = 'credentials' | 'confirm';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function Setup() {
  const { setup, vaultBootstrapSignup, vaultBootstrapLogin, error, clearError, loading } = useWalletStore();
  const [mode, setMode] = useState<Mode>('vault');
  const [step, setStep] = useState<Step>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const [localError, setLocalError] = useState('');
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const strength = checkPasswordStrength(password);
  const authMode: 'signup' | 'login' | 'unknown' =
    mode === 'byok' ? 'signup'
      : status === 'available' ? 'signup'
      : status === 'taken' ? 'login'
      : 'unknown';

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
    setLocalError('');
    checkUsername(value);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setStep('credentials');
    setUsername('');
    setPassword('');
    setConfirm('');
    setStatus('idle');
    setLocalError('');
    clearError();
  }

  function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (mode === 'vault') {
      if (!username || !password) return;
      if (status === 'checking' || status === 'invalid') return;
      if (authMode === 'login') {
        void vaultBootstrapLogin(username.toLowerCase().trim(), password);
        return;
      }
      if (authMode !== 'signup') return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (strength.score < 2) {
      setLocalError('Password is too weak. ' + (strength.feedback[0] || ''));
      return;
    }

    setStep('confirm');
  }

  function handleConfirmSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (password !== confirm) {
      setLocalError('Passwords do not match');
      return;
    }

    if (mode === 'vault') {
      void vaultBootstrapSignup(username.toLowerCase().trim(), password);
    } else {
      void setup(password);
    }
  }

  const displayError = localError || error;

  const canSubmitCredentials =
    !loading &&
    password.length > 0 &&
    (mode === 'byok'
      ? password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2
      : username.length >= 3 &&
        (authMode === 'login' ||
          (authMode === 'signup' && password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2)));

  const credentialsButtonLabel =
    loading ? 'Working...'
      : status === 'checking' ? 'Checking username...'
      : mode === 'byok' ? 'Continue'
      : authMode === 'login' ? 'Sign in'
      : authMode === 'signup' ? 'Continue'
      : 'Continue';

  if (step === 'confirm') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Confirm your password</div>

        <form onSubmit={handleConfirmSubmit} style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Re-enter your password. This encrypts your keys on this device
            {mode === 'vault' ? ' and your vault.' : '.'} If you lose it, your keys are gone.
          </p>

          {displayError && <div className="error">{displayError}</div>}

          <div className="form-group">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading || confirm.length === 0}
          >
            {loading ? 'Creating...' : mode === 'vault' ? 'Create account' : 'Create wallet'}
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
            onClick={() => { setStep('credentials'); setConfirm(''); setLocalError(''); clearError(); }}
          >
            ← Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">{mode === 'vault' ? 'Your vault, your keys' : 'Offline mode'}</div>

      <form onSubmit={handleCredentialsSubmit} style={{ marginTop: '16px' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {mode === 'vault'
            ? "End-to-end encrypted with your password. We can't read your keys."
            : 'Create a password to encrypt your keys on this device. Nothing leaves your browser.'}
        </p>

        {displayError && <div className="error">{displayError}</div>}

        {mode === 'vault' && (
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
        )}

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={authMode === 'login' ? 'Your password' : 'At least 12 characters'}
            autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            autoFocus={mode === 'byok'}
          />
          {authMode !== 'login' && password.length > 0 && <PasswordMeter strength={strength} />}
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!canSubmitCredentials}
        >
          {credentialsButtonLabel}
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
          onClick={() => switchMode(mode === 'vault' ? 'byok' : 'vault')}
        >
          {mode === 'vault' ? 'Got API keys? Add them here →' : '← Back to Vault signup'}
        </button>
      </form>
    </div>
  );
}
