'use client';

import { useState, useEffect } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import { Playground } from './components/Playground';

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
      {session && (
        <header className="header">
          <div className="header-left">
            <h1 className="logo">Byoky <span className="logo-sub">demo</span></h1>
          </div>
          <div className="header-right">
            <div className="connected">
              <span className="connected-dot" />
              <span className="connected-text">Connected</span>
              <button className="btn btn-ghost" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </div>
        </header>
      )}

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
              <div className="connect-flow-visual">
                <div className="connect-flow-node">
                  <div className="connect-flow-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
                  </div>
                  <span>Your Keys</span>
                </div>
                <div className="connect-flow-line"><span className="connect-flow-pulse" /></div>
                <div className="connect-flow-node connect-flow-node-highlight">
                  <div className="connect-flow-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  </div>
                  <span>Byoky Wallet</span>
                  <small>encrypted</small>
                </div>
                <div className="connect-flow-line"><span className="connect-flow-pulse connect-flow-pulse-2" /></div>
                <div className="connect-flow-node">
                  <div className="connect-flow-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
                  </div>
                  <span>Proxy</span>
                  <small>no keys exposed</small>
                </div>
                <div className="connect-flow-line"><span className="connect-flow-pulse connect-flow-pulse-3" /></div>
                <div className="connect-flow-node">
                  <div className="connect-flow-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <span>AI API</span>
                </div>
              </div>

              <h2>Connect your Byoky wallet</h2>
              <p>
                This demo uses your own API keys to chat with Claude, GPT-4o, Gemini,
                and 12 more providers. Your keys never leave your device.
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-lg" onClick={handleConnect}>
                  <WalletIcon />
                  Connect Wallet
                </button>
              </div>
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
              <div className="connect-capabilities">
                <h3>What you&apos;ll get</h3>
                <div className="connect-caps-grid">
                  <div className="connect-cap">
                    <strong>Streaming Chat</strong>
                    <span>Multi-provider AI chat with real-time streaming</span>
                  </div>
                  <div className="connect-cap">
                    <strong>Tool Use</strong>
                    <span>Watch AI call functions in an agentic loop</span>
                  </div>
                  <div className="connect-cap">
                    <strong>Structured Output</strong>
                    <span>Extract JSON from any text with schema validation</span>
                  </div>
                  <div className="connect-cap">
                    <strong>Backend Relay</strong>
                    <span>See server-to-browser key proxying in action</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="connect-install">
              <p>Don&apos;t have Byoky?</p>
              <div className="connect-install-links">
                <a
                  href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
                  className="btn btn-ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chrome Extension
                </a>
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/byoky/"
                  className="btn btn-ghost"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Firefox Extension
                </a>
              </div>
            </div>
          </div>
        ) : (
          <Playground session={session} />
        )}
      </main>

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
