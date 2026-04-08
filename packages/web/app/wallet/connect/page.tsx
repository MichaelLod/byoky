'use client';

import { useState } from 'react';

const VAULT_URL = process.env.NEXT_PUBLIC_VAULT_URL || 'http://localhost:3100';

type Mode = 'login' | 'signup';

export default function WalletConnect() {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }
    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (mode === 'signup' && password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }

    setLoading(true);

    try {
      const endpoint = mode === 'signup' ? '/auth/signup' : '/auth/login';
      const resp = await fetch(`${VAULT_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          password,
        }),
      });

      const data = await resp.json() as {
        token?: string;
        user?: { id: string; username: string };
        error?: { code: string; message: string };
      };

      if (!resp.ok || !data.token) {
        setError(data.error?.message ?? 'Authentication failed');
        setLoading(false);
        return;
      }

      // Send token back to the opener (SDK popup flow)
      setSuccess(true);

      if (window.opener) {
        window.opener.postMessage({
          type: 'BYOKY_WALLET_AUTH',
          token: data.token,
          user: data.user,
          vaultUrl: VAULT_URL,
        }, '*');
      }

      // Also store in sessionStorage for redirect flow
      sessionStorage.setItem('byoky_vault_token', data.token);

      // Auto-close after short delay
      setTimeout(() => {
        window.close();
      }, 1500);
    } catch (err) {
      setError('Could not connect to Byoky. Please try again.');
    }

    setLoading(false);
  }

  if (success) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>&#10003;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Connected</h2>
            <p style={{ color: '#71717a', fontSize: '14px' }}>
              Returning to the app...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>Byoky</div>
          <p style={{ color: '#71717a', fontSize: '14px' }}>
            {mode === 'login' ? 'Sign in to your wallet' : 'Create your AI wallet'}
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', marginBottom: '20px',
          background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '3px',
        }}>
          <button
            onClick={() => { setMode('login'); setError(null); }}
            style={{
              flex: 1, padding: '8px', borderRadius: '8px', border: 'none',
              background: mode === 'login' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: mode === 'login' ? '#e4e4e7' : '#71717a',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => { setMode('signup'); setError(null); }}
            style={{
              flex: 1, padding: '8px', borderRadius: '8px', border: 'none',
              background: mode === 'signup' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: mode === 'signup' ? '#e4e4e7' : '#71717a',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div style={{
            marginBottom: '16px', padding: '10px 14px', borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#a1a1aa', marginBottom: '6px' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              autoFocus
              autoComplete="username"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#a1a1aa', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 12 characters' : 'Enter password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              style={inputStyle}
            />
          </div>

          {mode === 'signup' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#a1a1aa', marginBottom: '6px' }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
                style={inputStyle}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: '10px',
              border: 'none', background: loading ? '#374151' : '#0ea5e9',
              color: '#fff', fontSize: '15px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: '4px',
            }}
          >
            {loading ? 'Connecting...' : mode === 'login' ? 'Sign In' : 'Create Wallet'}
          </button>
        </form>

        <p style={{ fontSize: '11px', color: '#52525b', textAlign: 'center', marginTop: '16px', lineHeight: 1.5 }}>
          {mode === 'signup'
            ? 'Your wallet encrypts everything locally. We never see your API keys.'
            : 'One account, every AI app. No API keys needed.'}
        </p>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#09090b',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#e4e4e7',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '380px',
  padding: '32px',
  background: '#18181b',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '16px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.1)',
  background: '#09090b',
  color: '#e4e4e7',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};
