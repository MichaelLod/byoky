import { useState, type FormEvent } from 'react';
import { useWalletStore } from '../store';
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@byoky/core';
import { PasswordMeter } from '../components/PasswordMeter';

type Step = 'welcome' | 'password' | 'confirm';

export function Setup() {
  const { setup, error, clearError, loading } = useWalletStore();
  const [step, setStep] = useState<Step>('welcome');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState('');

  const strength = checkPasswordStrength(password);
  const canSubmitPassword = !loading && password.length >= MIN_PASSWORD_LENGTH && strength.score >= 2;

  function goTo(next: Step) {
    setStep(next);
    setLocalError('');
    clearError();
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');
    clearError();

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

    void setup(password);
  }

  const displayError = localError || error;

  if (step === 'welcome') {
    return (
      <div className="center-page">
        <div className="brand-mark">
          <img src="/icon.svg" alt="" />
        </div>
        <div className="logo-large">Byoky</div>
        <div className="tagline">Your wallet for AI API keys</div>

        <div style={{ marginTop: '24px', width: '100%' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5, textAlign: 'center' }}>
            Apps connect to your wallet and send their AI requests through it.
            Your keys stay encrypted on this device and never leave it.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => goTo('password')}
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="center-page">
        <div className="brand-mark">
          <img src="/icon.svg" alt="" />
        </div>
        <div className="logo-large">Byoky</div>
        <div className="tagline">Confirm your password</div>

        <form onSubmit={handleConfirmSubmit} style={{ marginTop: '16px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Re-enter your password. It encrypts your keys on this device. If you
            lose it, your keys are gone.
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
            {loading ? 'Creating...' : 'Create wallet'}
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
            onClick={() => { setConfirm(''); goTo('password'); }}
          >
            ← Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="center-page">
      <div className="brand-mark">
        <img src="/icon.svg" alt="" />
      </div>
      <div className="logo-large">Byoky</div>
      <div className="tagline">Set a password</div>

      <form onSubmit={handlePasswordSubmit} style={{ marginTop: '16px' }}>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
          This password encrypts your keys on this device. Nothing leaves your browser.
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
            autoComplete="new-password"
            autoFocus
          />
          {password.length > 0 && <PasswordMeter strength={strength} />}
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!canSubmitPassword}
        >
          {loading ? 'Working...' : 'Continue'}
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
          onClick={() => goTo('welcome')}
        >
          ← Back
        </button>
      </form>
    </div>
  );
}
