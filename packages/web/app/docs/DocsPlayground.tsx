'use client';

import { useEffect, useState } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import { Playground, type PlaygroundTab } from '../demo/components/Playground';
import '../demo/demo.css';

const byoky = new Byoky({ timeout: 120_000 });

const PROVIDERS = [
  'anthropic', 'openai', 'gemini', 'groq', 'deepseek', 'xai',
  'mistral', 'together', 'fireworks', 'perplexity', 'openrouter', 'cohere',
] as const;

interface Props {
  open: boolean;
  tab?: PlaygroundTab;
  onClose: () => void;
}

export function DocsPlayground({ open, tab, onClose }: Props) {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [triedReconnect, setTriedReconnect] = useState(false);

  useEffect(() => {
    if (!open || triedReconnect) return;
    setTriedReconnect(true);
    byoky.tryReconnect().then((s) => {
      if (s) onConnected(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function onConnected(s: ByokySession) {
    s.onDisconnect(() => setSession(null));
    s.onProvidersUpdated((providers) => {
      setSession((prev) => (prev ? { ...prev, providers } : null));
    });
    setSession(s);
  }

  async function handleConnect() {
    setError(null);
    setConnecting(true);
    try {
      const s = await byoky.connect({
        providers: PROVIDERS.map((id) => ({ id, required: false })),
        modal: true,
      });
      onConnected(s);
    } catch (e) {
      const err = e as Error;
      if (err.message !== 'User cancelled') setError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    session?.disconnect();
    setSession(null);
  }

  return (
    <>
      <div
        className={`docs-drawer-backdrop ${open ? 'docs-drawer-backdrop-open' : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`docs-drawer ${open ? 'docs-drawer-open' : ''}`}
        role="dialog"
        aria-label="Byoky playground"
        aria-hidden={!open}
      >
        <header className="docs-drawer-header">
          <div className="docs-drawer-title">
            <span className="docs-drawer-dot" data-connected={session ? 'true' : 'false'} />
            <span>Playground</span>
            {session && (
              <button className="docs-drawer-disconnect" onClick={handleDisconnect}>
                Disconnect
              </button>
            )}
          </div>
          <button
            className="docs-drawer-close"
            onClick={onClose}
            aria-label="Close playground"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="docs-drawer-body">
          {session ? (
            <Playground session={session} initialTab={tab} />
          ) : (
            <ConnectCard
              connecting={connecting}
              error={error}
              onConnect={handleConnect}
              onClearError={() => setError(null)}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function ConnectCard({
  connecting,
  error,
  onConnect,
  onClearError,
}: {
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onClearError: () => void;
}) {
  return (
    <div className="docs-drawer-connect">
      <h3>Try it live</h3>
      <p>
        Connect your Byoky wallet to run the examples from the docs against
        your own API keys. Keys stay encrypted in your wallet &mdash; this
        page never sees them.
      </p>

      {error && (
        <div className="docs-drawer-error" role="alert">
          <span>{error}</span>
          <button onClick={onClearError} aria-label="Dismiss error">&times;</button>
        </div>
      )}

      <button
        className="docs-drawer-connect-btn"
        onClick={onConnect}
        disabled={connecting}
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>

      <ul className="docs-drawer-features">
        <li>Runs against the same SDK the snippets import.</li>
        <li>Keys never leave the extension.</li>
        <li>Revoke access anytime from the wallet.</li>
      </ul>

      <div className="docs-drawer-install">
        Don&apos;t have Byoky yet?
        <div className="docs-drawer-install-links">
          <a
            href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
            target="_blank"
            rel="noopener noreferrer"
          >
            Chrome
          </a>
          <a
            href="https://addons.mozilla.org/en-US/firefox/addon/byoky/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Firefox
          </a>
          <a
            href="https://apps.apple.com/app/byoky/id6760779919"
            target="_blank"
            rel="noopener noreferrer"
          >
            iOS
          </a>
          <a
            href="https://play.google.com/store/apps/details?id=com.byoky.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            Android
          </a>
        </div>
      </div>
    </div>
  );
}
