import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

async function sendInternal(action: string, payload?: unknown): Promise<Record<string, unknown>> {
  return browser.runtime.sendMessage({
    type: 'BYOKY_INTERNAL',
    action,
    payload,
  });
}

type Mode = 'vault' | 'byok';
type Step = 'credentials' | 'confirm';

export function Setup() {
  const { setup, enableCloudVault, error, clearError, loading } = useWalletStore();
  const [mode, setMode] = useState<Mode>('vault');
  const [step, setStep] = useState<Step>('credentials');
  const [isSignup, setIsSignup] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const checkTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const strength = checkPasswordStrength(password);

  const checkUsername = useCallback((value: string) => {
    clearTimeout(checkTimer.current);
    const trimmed = value.toLowerCase().trim();
    if (!trimmed || trimmed.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/.test(trimmed)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    checkTimer.current = setTimeout(async () => {
      const result = await sendInternal('cloudVaultCheckUsername', { username: trimmed });
      if (result.available) {
        setUsernameStatus('available');
      } else {
        setUsernameStatus(result.reason === 'invalid' ? 'invalid' : 'taken');
      }
    }, 400);
  }, []);

  useEffect(() => () => clearTimeout(checkTimer.current), []);

  function handleUsernameChange(value: string) {
    setUsername(value);
    if (isSignup && mode === 'vault') checkUsername(value);
  }

  function resetFields() {
    setPassword('');
    setConfirm('');
    setUsername('');
    setLocalError('');
    setUsernameStatus('idle');
    setStep('credentials');
    clearError();
  }

  // Step 1: validate credentials, advance to confirm step (signup) or submit (login)
  function handleContinue(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setLocalError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (isSignup && strength.score < 2) {
      setLocalError('Password is too weak. ' + (strength.feedback[0] || ''));
      return;
    }
    if (mode === 'vault' && !username) {
      setLocalError('Username is required');
      return;
    }
    if (mode === 'vault' && isSignup && (usernameStatus === 'taken' || usernameStatus === 'invalid')) {
      setLocalError('Please choose a valid username');
      return;
    }

    if (!isSignup) {
      // Login — no confirm step needed
      doSubmit();
    } else {
      // Signup — go to confirm password step
      setStep('confirm');
      setLocalError('');
    }
  }

  // Step 2 or direct login submit
  async function handleConfirmSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');

    if (password !== confirm) {
      setLocalError('Passwords do not match');
      return;
    }
    doSubmit();
  }

  async function doSubmit() {
    if (mode === 'vault') {
      await setup(password);
      if (useWalletStore.getState().error) return;
      await enableCloudVault(username, password, isSignup);
    } else {
      await setup(password);
    }
  }

  const displayError = localError || error;

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: '1.5px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: '14px', outline: 'none',
  };

  // ── Confirm password step (step 2 of signup) ──
  if (step === 'confirm') {
    return (
      <div className="center-page">
        <div className="logo-large">Byoky</div>
        <div className="tagline">Confirm your password</div>

        <form onSubmit={handleConfirmSubmit} style={{ width: '100%', maxWidth: '300px', position: 'relative' }}>
          {displayError && <div className="error" style={{ marginBottom: '12px' }}>{displayError}</div>}

          <div style={{ marginBottom: '16px' }}>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoFocus
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !confirm}
            style={{ padding: '14px', fontSize: '16px', fontWeight: 700 }}
          >
            {loading ? 'Creating...' : 'Create Wallet'}
          </button>

          <button
            type="button"
            onClick={() => { setStep('credentials'); setConfirm(''); setLocalError(''); clearError(); }}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              fontSize: '12px', cursor: 'pointer', marginTop: '14px',
              textDecoration: 'underline', padding: 0, width: '100%', textAlign: 'center',
            }}
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  // ── Main credentials step ──
  return (
    <div className="center-page">
      <div className="logo-large">Byoky</div>
      <div className="tagline">One wallet.<br />Every AI app.</div>

      <form onSubmit={handleContinue} style={{ width: '100%', maxWidth: '300px', position: 'relative' }}>
        {mode === 'vault' && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <button
              type="button"
              className={`btn ${isSignup ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '13px', padding: '8px' }}
              onClick={() => { setIsSignup(true); resetFields(); }}
            >
              Sign Up
            </button>
            <button
              type="button"
              className={`btn ${!isSignup ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '13px', padding: '8px' }}
              onClick={() => { setIsSignup(false); resetFields(); }}
            >
              Log In
            </button>
          </div>
        )}

        {mode === 'byok' && (
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', textAlign: 'center' }}>
            Create a local password<br />to encrypt your API keys.
          </p>
        )}

        {displayError && <div className="error" style={{ marginBottom: '12px' }}>{displayError}</div>}

        {mode === 'vault' && (
          <div style={{ marginBottom: '10px' }}>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              autoFocus
              style={inputStyle}
            />
            {isSignup && username.length >= 3 && (
              <p style={{
                fontSize: '11px',
                margin: '4px 0 0',
                color: usernameStatus === 'available' ? '#4ade80'
                  : usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'var(--danger)'
                  : 'var(--text-muted)',
              }}>
                {usernameStatus === 'checking' && 'Checking availability...'}
                {usernameStatus === 'available' && 'Username is available'}
                {usernameStatus === 'taken' && 'Username is already taken'}
                {usernameStatus === 'invalid' && 'Letters, numbers, hyphens, underscores (3-30 chars)'}
              </p>
            )}
          </div>
        )}

        <div style={{ marginBottom: isSignup && password.length > 0 ? '6px' : '16px' }}>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'Password, 12 characters' : 'Password'}
            autoFocus={mode === 'byok'}
            style={inputStyle}
          />
        </div>

        {isSignup && password.length > 0 && (
          <div style={{ height: '40px', marginBottom: '2px' }}>
            <PasswordMeter strength={strength} />
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={
            loading ||
            password.length < MIN_PASSWORD_LENGTH ||
            (isSignup && strength.score < 2) ||
            (mode === 'vault' && !username) ||
            (mode === 'vault' && isSignup && (usernameStatus === 'taken' || usernameStatus === 'invalid'))
          }
          style={{ padding: '14px', fontSize: '16px', fontWeight: 700 }}
        >
          {loading ? 'Connecting...' : isSignup ? 'Continue' : 'Log In'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => { setMode(mode === 'vault' ? 'byok' : 'vault'); resetFields(); setIsSignup(true); }}
        style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: '12px', cursor: 'pointer', marginTop: '16px',
          textDecoration: 'underline', padding: 0,
          display: 'flex', alignItems: 'center', gap: '4px',
        }}
      >
        {mode === 'vault' ? 'Got API keys? Add them here' : (<><span style={{ fontSize: '14px' }}>&#8592;</span> Back to Vault signup</>)}
      </button>
    </div>
  );
}
