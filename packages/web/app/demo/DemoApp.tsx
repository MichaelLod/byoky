'use client';

import { useState, useEffect } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import { Playground } from './components/Playground';
import { CodeExample } from './components/CodeExample';

const byoky = new Byoky({ timeout: 120_000 });

export function DemoApp() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    byoky.tryReconnect().then((s) => {
      if (s) onConnected(s);
      setRestoring(false);
    });
  }, []);

  function onConnected(s: ByokySession) {
    s.onDisconnect(() => { setSession(null); });
    s.onProvidersUpdated((providers) => {
      setSession(prev => prev ? { ...prev, providers } : null);
    });
    setSession(s);
  }

  async function handleConnect() {
    setError(null);
    try {
      const s = await byoky.connect({
        providers: [
          { id: 'anthropic', required: false },
          { id: 'openai', required: false },
          { id: 'gemini', required: false },
        ],
        modal: true,
      });
      onConnected(s);
    } catch (e) {
      const err = e as Error;
      if (err.message === 'User cancelled') return;
      setError(err.message);
    }
  }

  function handleDisconnect() {
    session?.disconnect();
    setSession(null);
  }

  return (
    <div className="demo-app">
      <header className="header">
        <div className="header-left">
          <h1 className="logo">Byoky <span className="logo-sub">demo</span></h1>
          <p className="header-desc">Example app showing Byoky wallet integration</p>
        </div>
        <div className="header-right">
          {session ? (
            <div className="connected">
              <span className="connected-dot" />
              <span className="connected-text">Connected</span>
              <button className="btn btn-ghost" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect}>
              <WalletIcon />
              Connect Byoky
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      <main className="main">
        {restoring ? null : !session ? (
          <div className="connect-page">
            <div className="connect-card">
              <div className="connect-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <h2>Connect your Byoky wallet</h2>
              <p>
                This demo app uses the Byoky SDK to chat with AI models using your own
                API keys. Your keys never leave your device.
              </p>
              <button className="btn btn-primary btn-lg" onClick={handleConnect}>
                Connect Wallet
              </button>
              <div className="connect-features">
                <div className="connect-feature">
                  <span className="feature-check">&#10003;</span>
                  Keys stay encrypted in your wallet
                </div>
                <div className="connect-feature">
                  <span className="feature-check">&#10003;</span>
                  This app never sees your API keys
                </div>
                <div className="connect-feature">
                  <span className="feature-check">&#10003;</span>
                  Revoke access anytime from the wallet
                </div>
              </div>
            </div>
            <div className="connect-install">
              <p>
                Don&apos;t have Byoky?{' '}
                <a href="https://byoky.com" target="_blank" rel="noopener noreferrer">
                  Get the app or extension
                </a>
              </p>
            </div>
          </div>
        ) : (
          <Playground session={session} />
        )}
      </main>

      <section className="code-section">
        <CodeExample />
      </section>

      <footer className="footer">
        <span>
          Built with{' '}
          <a href="https://byoky.com" target="_blank" rel="noopener noreferrer">
            Byoky
          </a>
        </span>
        <a
          href="https://github.com/MichaelLod/byoky"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </footer>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}
