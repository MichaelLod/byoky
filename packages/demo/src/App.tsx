import { useState } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import { ConnectWallet } from './ConnectWallet';
import { Chat } from './Chat';
import { CodeExample } from './CodeExample';

const byoky = new Byoky({ timeout: 120_000 });

export function App() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setSession(s);
    } catch (e) {
      const err = e as Error;
      if (err.message.includes('not installed')) {
        setError('Byoky wallet not found. Install the extension first.');
      } else if (err.message.includes('rejected')) {
        setError('Connection rejected by user.');
      } else {
        setError(err.message);
      }
    }
  }

  function handleDisconnect() {
    session?.disconnect();
    setSession(null);
  }

  return (
    <div className="app">
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
        {!session ? (
          <ConnectWallet onConnect={handleConnect} />
        ) : (
          <Chat session={session} />
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
