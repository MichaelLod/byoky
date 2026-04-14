import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
type Mode = 'vault-signup' | 'vault-login' | 'byok';
type Step = 'welcome' | 'credentials' | 'confirm';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  }) as Promise<Record<string, unknown>>;
}

export function Setup() {
  const { setup, vaultBootstrapSignup, vaultBootstrapLogin, error, clearError, loading } = useWalletStore();
  const [step, setStep] = useState<Step>('welcome');
  const [mode, setMode] = useState<Mode>('vault-signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<UsernameStatus>('idle');
  const [localError, setLocalError] = useState('');
  const checkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const strength = checkPasswordStrength(password);
  const isVault = mode === 'vault-signup' || mode === 'vault-login';
  const isSignup = mode === 'vault-signup' || mode === 'byok';

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

  function goToCredentials(next: Mode) {
    setMode(next);
    setStep('credentials');
    setUsername('');
    setPassword('');
    setConfirm('');
    setStatus('idle');
    setLocalError('');
    clearError();
  }

  function switchVaultMode(next: 'vault-signup' | 'vault-login') {
    if (!isVault) return;
    setMode(next);
    setLocalError('');
    clearError();
  }

  function handleUsernameChange(value: string) {
    setUsername(value);
    clearError();
    setLocalError('');
    checkUsername(value);
  }

  function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');
    clearError();

    if (isVault) {
      if (!username || !password) return;
      if (mode === 'vault-login') {
        void vaultBootstrapLogin(username.toLowerCase().trim(), password);
        return;
      }
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

    if (mode === 'vault-signup') {
      void vaultBootstrapSignup(username.toLowerCase().trim(), password);
    } else if (mode === 'byok') {
      void setup(password);
    }
  }

  const displayError = localError || error;

  // Welcome step — primary "Get Started" (→ vault signup) + BYOK link.
  if (step === 'welcome') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Your encrypted wallet for AI API keys</div>

        <div style={{ marginTop: '24px', width: '100%' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5, textAlign: 'center' }}>
            Sync across devices, end-to-end encrypted.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: '12px' }}
            onClick={() => goToCredentials('vault-signup')}
          >
            Get Started
          </button>

          <button
            type="button"
            className="text-link"
            style={{
              display: 'block',
              width: '100%',
              fontSize: '12px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '8px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => goToCredentials('byok')}
          >
            Continue with your API keys
          </button>
        </div>
      </div>
    );
  }

  // Confirm step —— shown for signup and BYOK only.
  if (step === 'confirm') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Confirm your password</div>

        <form onSubmit={handleConfirmSubmit} style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Re-enter your password. This encrypts your keys on this device
            {mode === 'vault-signup' ? ' and your vault.' : '.'} If you lose it, your keys are gone.
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
            {loading ? 'Creating...' : mode === 'vault-signup' ? 'Create account' : 'Create wallet'}
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

  // Credentials step (vault signup/login or BYOK).
  const mismatchHint =
    isVault && status === 'taken' && mode === 'vault-signup' ? 'signup-taken'
      : isVault && status === 'available' && mode === 'vault-login' ? 'login-missing'
      : null;

  const canSubmitCredentials =
    !loading &&
    password.length > 0 &&
    (mode === 'byok'
      ? password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2
      : username.length >= 3 &&
        (mode === 'vault-login'
          ? status === 'taken'
          : status === 'available' && password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2));

  const credentialsButtonLabel =
    loading ? 'Working...'
      : status === 'checking' ? 'Checking username...'
      : mode === 'vault-login' ? 'Sign in'
      : 'Continue';

  const screenTitle = mode === 'byok' ? 'Set a password' : 'Your vault, your keys';

  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">{screenTitle}</div>

      <form onSubmit={handleCredentialsSubmit} style={{ marginTop: '16px' }}>
        {isVault && (
          <div style={{
            display: 'flex',
            gap: '4px',
            padding: '4px',
            background: 'var(--bg-raised)',
            borderRadius: '10px',
            marginBottom: '16px',
          }}>
            <button
              type="button"
              onClick={() => switchVaultMode('vault-signup')}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: mode === 'vault-signup' ? 600 : 400,
                background: mode === 'vault-signup' ? 'var(--bg-card)' : 'transparent',
                color: mode === 'vault-signup' ? 'var(--text)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '7px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => switchVaultMode('vault-login')}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: mode === 'vault-login' ? 600 : 400,
                background: mode === 'vault-login' ? 'var(--bg-card)' : 'transparent',
                color: mode === 'vault-login' ? 'var(--text)' : 'var(--text-muted)',
                border: 'none',
                borderRadius: '7px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Sign in
            </button>
          </div>
        )}

        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          {mode === 'byok'
            ? 'This password encrypts your keys on this device. Nothing leaves your browser.'
            : isSignup
              ? "End-to-end encrypted with your password. We can't read your keys."
              : 'Sign in to sync keys from your vault.'}
        </p>

        {displayError && <div className="error">{displayError}</div>}

        {isVault && (
          <div className="form-group">
            <label htmlFor="vault-username">Username</label>
            <input
              id="vault-username"
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder={mode === 'vault-login' ? 'Your username' : 'Choose a username'}
              autoComplete="username"
              autoFocus
            />
            {username.length >= 3 && (
              <p style={{
                fontSize: '11px',
                margin: '4px 0 0',
                color: status === 'available' && mode === 'vault-signup' ? 'var(--success, #4caf50)'
                  : status === 'taken' && mode === 'vault-login' ? 'var(--success, #4caf50)'
                  : status === 'invalid' || mismatchHint ? 'var(--error, #ef4444)'
                  : 'var(--text-muted)',
              }}>
                {status === 'checking' && 'Checking...'}
                {status === 'available' && mode === 'vault-signup' && 'Available'}
                {status === 'taken' && mode === 'vault-login' && 'Account found'}
                {status === 'invalid' && 'Letters, numbers, hyphens, underscores only (3-30 chars)'}
                {mismatchHint === 'signup-taken' && (
                  <>
                    Already taken.{' '}
                    <button
                      type="button"
                      onClick={() => switchVaultMode('vault-login')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                    >
                      Sign in instead
                    </button>
                  </>
                )}
                {mismatchHint === 'login-missing' && (
                  <>
                    No account with this username.{' '}
                    <button
                      type="button"
                      onClick={() => switchVaultMode('vault-signup')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', padding: 0, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}
                    >
                      Create one
                    </button>
                  </>
                )}
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
            placeholder={mode === 'vault-login' ? 'Your password' : 'At least 12 characters'}
            autoComplete={mode === 'vault-login' ? 'current-password' : 'new-password'}
            autoFocus={mode === 'byok'}
          />
          {isSignup && password.length > 0 && <PasswordMeter strength={strength} />}
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
          onClick={() => { setStep('welcome'); setLocalError(''); clearError(); }}
        >
          ← Back
        </button>
      </form>
    </div>
  );
}
