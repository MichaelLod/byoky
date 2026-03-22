'use client';

import { useState, useEffect } from 'react';
import { Byoky, type ByokySession, type ConnectResponse, isExtensionInstalled } from '@byoky/sdk';
import { ConnectWallet } from './components/ConnectWallet';
import { Playground } from './components/Playground';
import { CodeExample } from './components/CodeExample';

const byoky = new Byoky({ timeout: 120_000 });
const SESSION_KEY = 'byoky-demo-session';

function saveSession(response: ConnectResponse) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(response)); } catch {}
}

function clearSavedSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

function loadSavedSession(): ConnectResponse | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function DemoApp() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  useEffect(() => {
    const saved = loadSavedSession();
    if (!saved) { setRestoring(false); return; }
    byoky.reconnect(saved).then((s) => {
      if (s) {
        s.onDisconnect(() => { clearSavedSession(); setSession(null); });
        setSession(s);
      } else {
        clearSavedSession();
      }
      setRestoring(false);
    });
  }, []);

  function onConnected(s: ByokySession) {
    s.onDisconnect(() => { clearSavedSession(); setSession(null); setPairingCode(null); });
    saveSession({ sessionKey: s.sessionKey, proxyUrl: s.proxyUrl, providers: s.providers });
    setSession(s);
    setPairingCode(null);
    setIsPairing(false);
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
      });
      onConnected(s);
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('not installed')) {
        setError('Byoky wallet not found. Install the extension or connect with the mobile app.');
      } else if (err.message.includes('rejected')) {
        setError('Connection rejected by user.');
      } else {
        setError(err.message);
      }
    }
  }

  async function handleMobileConnect() {
    setError(null);
    setIsPairing(true);
    setPairingCode(null);
    try {
      const s = await byoky.connect({
        providers: [
          { id: 'anthropic', required: false },
          { id: 'openai', required: false },
          { id: 'gemini', required: false },
        ],
        useRelay: true,
        onPairingReady: (code) => {
          setPairingCode(code);
        },
      });
      onConnected(s);
    } catch (e) {
      const err = e as Error;
      setError(err.message);
      setIsPairing(false);
      setPairingCode(null);
    }
  }

  function handleCancelPairing() {
    setIsPairing(false);
    setPairingCode(null);
  }

  function handleDisconnect() {
    session?.disconnect();
    clearSavedSession();
    setSession(null);
  }

  const hasExtension = typeof window !== 'undefined' && isExtensionInstalled();

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
            <button className="btn btn-primary" onClick={hasExtension ? handleConnect : handleMobileConnect}>
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
          <ConnectWallet
            onConnect={handleConnect}
            onMobileConnect={handleMobileConnect}
            pairingCode={pairingCode}
            isPairing={isPairing}
            onCancelPairing={handleCancelPairing}
            hasExtension={hasExtension}
          />
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
