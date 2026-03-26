'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Byoky } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';
import './apps.css';

/* ─── Types ──────────────────────────────────── */

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  providers: string[];
  category: string;
  htmlUrl?: string;
  gistId?: string;
  publishedAt: string;
}

const CATEGORIES = ['all', 'chat', 'writing', 'code', 'image', 'data', 'productivity', 'fun', 'other'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  chat: 'Chat',
  writing: 'Writing',
  code: 'Code',
  image: 'Image',
  data: 'Data',
  productivity: 'Productivity',
  fun: 'Fun',
  other: 'Other',
};

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97706',
  openai: '#10b981',
  gemini: '#6366f1',
};

const CATEGORY_COLORS: Record<string, string> = {
  chat: '#0ea5e9',
  writing: '#8b5cf6',
  code: '#10b981',
  image: '#f59e0b',
  data: '#06b6d4',
  productivity: '#6366f1',
  fun: '#ec4899',
  other: '#64748b',
};

/* ─── Main Component ─────────────────────────── */

export default function MiniApps() {
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [walletSession, setWalletSession] = useState<ByokySession | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [activeApp, setActiveApp] = useState<RegistryEntry | null>(null);
  const [appHtml, setAppHtml] = useState<string | null>(null);
  const [loadingApp, setLoadingApp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Fetch registry on mount + load user-published apps ── */
  useEffect(() => {
    fetch('/apps/registry.json')
      .then((r) => r.json())
      .then((data: RegistryEntry[]) => {
        const userApps: RegistryEntry[] = JSON.parse(localStorage.getItem('byoky-user-apps') || '[]');
        setRegistry([...userApps, ...data]);
      })
      .catch(() => setError('Failed to load app registry'));
  }, []);

  /* ── Auto-reconnect to existing wallet session on mount ── */
  useEffect(() => {
    const byoky = new Byoky();
    byoky.tryReconnect().then((session) => {
      if (session) setWalletSession(session);
    });
  }, []);

  /* ── Auto-dismiss error ── */
  useEffect(() => {
    if (!error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  /* ── Filter apps ── */
  const filteredApps = registry.filter((app) => {
    const matchesCategory = category === 'all' || app.category === category;
    const matchesSearch =
      !search ||
      app.name.toLowerCase().includes(search.toLowerCase()) ||
      app.description.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  /* ── Wallet connect ── */
  const connectWallet = useCallback(async () => {
    setWalletConnecting(true);
    setError(null);
    try {
      const byoky = new Byoky();
      const session = await byoky.connect({
        providers: [
          { id: 'anthropic', required: false },
          { id: 'openai', required: false },
          { id: 'gemini', required: false },
        ],
        modal: true,
      });
      setWalletSession(session);
    } catch (e) {
      if (e instanceof Error && e.message.includes('cancelled')) return;
      setError(e instanceof Error ? e.message : 'Failed to connect wallet');
    } finally {
      setWalletConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    walletSession?.disconnect();
    setWalletSession(null);
  }, [walletSession]);

  /* ── Open app ── */
  const openApp = useCallback(
    async (app: RegistryEntry) => {
      if (!walletSession) {
        connectWallet();
        return;
      }

      setLoadingApp(true);
      setActiveApp(app);
      setAppHtml(null);
      window.history.pushState({ miniapp: true }, '');

      try {
        let url: string;
        if (app.htmlUrl) {
          url = app.htmlUrl;
        } else if (app.gistId) {
          url = `https://gist.githubusercontent.com/${app.author}/${app.gistId}/raw`;
        } else {
          throw new Error('No HTML source for this app');
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to load app (${res.status})`);
        const html = await res.text();
        setAppHtml(html);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load app');
        setActiveApp(null);
      } finally {
        setLoadingApp(false);
      }
    },
    [walletSession, connectWallet],
  );

  /* ── Close app ── */
  const closeApp = useCallback(() => {
    setActiveApp(null);
    setAppHtml(null);
    if (window.history.state?.miniapp) {
      window.history.back();
    }
  }, []);

  /* ── Browser back button closes overlay ── */
  useEffect(() => {
    if (!activeApp) return;
    const handler = () => {
      setActiveApp(null);
      setAppHtml(null);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [activeApp]);

  /* ── Build provider map for session sharing ── */
  const buildProviderMap = useCallback(() => {
    if (!walletSession) return {};
    const providerMap: Record<string, { available: boolean }> = {};
    for (const [id, info] of Object.entries(walletSession.providers)) {
      providerMap[id] = { available: (info as { available: boolean }).available };
    }
    return providerMap;
  }, [walletSession]);

  /* ── Send session to iframe proactively (handles race with MINIAPP_READY) ── */
  useEffect(() => {
    if (!activeApp || !appHtml || !walletSession) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const sendSession = () => {
      iframe.contentWindow?.postMessage(
        { type: 'BYOKY_SESSION', providers: buildProviderMap() },
        '*',
      );
    };

    // Send session once iframe loads (catches the race where MINIAPP_READY fires before our listener)
    iframe.addEventListener('load', sendSession);
    // Also send immediately in case iframe already loaded
    sendSession();

    return () => iframe.removeEventListener('load', sendSession);
  }, [activeApp, appHtml, walletSession, buildProviderMap]);

  /* ── Handle postMessage from iframe ── */
  useEffect(() => {
    if (!activeApp || !appHtml || !walletSession) return;

    const handler = async (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      // Only handle messages from our iframe or with our protocol types
      if (!event.data || typeof event.data.type !== 'string') return;
      const { type } = event.data;
      const isOurProtocol = type === 'MINIAPP_READY' || type === 'BYOKY_API_REQUEST';
      if (!isOurProtocol) return;

      if (type === 'MINIAPP_READY') {
        iframe.contentWindow.postMessage(
          { type: 'BYOKY_SESSION', providers: buildProviderMap() },
          '*',
        );
      }

      if (type === 'BYOKY_API_REQUEST') {
        const { requestId, provider, url, method, headers, body, stream } = event.data;

        try {
          const proxyFetch = walletSession.createFetch(provider);
          const response = await proxyFetch(url, { method, headers, body });

          if (stream && response.body) {
            iframe.contentWindow.postMessage(
              {
                type: 'BYOKY_API_RESPONSE_START',
                requestId,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
              },
              '*',
            );

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              iframe.contentWindow?.postMessage(
                {
                  type: 'BYOKY_API_RESPONSE_CHUNK',
                  requestId,
                  chunk: decoder.decode(value, { stream: true }),
                },
                '*',
              );
            }

            iframe.contentWindow?.postMessage(
              { type: 'BYOKY_API_RESPONSE_END', requestId },
              '*',
            );
          } else {
            const responseBody = await response.text();
            iframe.contentWindow.postMessage(
              {
                type: 'BYOKY_API_RESPONSE',
                requestId,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: responseBody,
              },
              '*',
            );
          }
        } catch (err) {
          iframe.contentWindow?.postMessage(
            {
              type: 'BYOKY_API_RESPONSE_ERROR',
              requestId,
              error: err instanceof Error ? err.message : 'Request failed',
            },
            '*',
          );
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [activeApp, appHtml, walletSession, buildProviderMap]);

  /* ── Escape to close ── */
  useEffect(() => {
    if (!activeApp) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeApp();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeApp, closeApp]);

  /* ── Connected providers ── */
  const connectedProviders = walletSession
    ? Object.entries(walletSession.providers)
        .filter(([, v]) => (v as { available: boolean }).available)
        .map(([k]) => k)
    : [];

  /* ── Render ── */
  return (
    <div className="ma-container">
      {/* ── Top Bar ── */}
      <header className="ma-topbar">
        <div className="ma-topbar-left">
          <a href="/" className="ma-brand">Byoky</a>
          <span className="ma-topbar-title">MiniApps</span>
        </div>
        <div className="ma-topbar-center">
          <div className="ma-search-wrap">
            <SearchIcon />
            <input
              className="ma-search"
              type="text"
              placeholder="Search apps..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="ma-topbar-right">
          <a href="/dev" className="ma-create-btn">
            <PlusIcon /> Create Your Own
          </a>
          {walletSession ? (
            <button className="ma-pill ma-pill-connected" onClick={disconnectWallet}>
              <span className="ma-dot" />
              {connectedProviders.length} provider{connectedProviders.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <button className="ma-pill" onClick={connectWallet} disabled={walletConnecting}>
              {walletConnecting ? (
                <><span className="ma-spinner-sm" /> Connecting...</>
              ) : (
                <><WalletIcon /> Connect Wallet</>
              )}
            </button>
          )}
        </div>
      </header>

      {/* ── Category Tabs ── */}
      <nav className="ma-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`ma-cat-tab${category === cat ? ' ma-cat-tab-active' : ''}`}
            onClick={() => setCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </nav>

      {/* ── App Grid ── */}
      <main className="ma-grid-container">
        {filteredApps.length > 0 ? (
          <div className="ma-grid">
            {filteredApps.map((app) => (
              <AppCard key={app.id} app={app} onClick={() => openApp(app)} />
            ))}
            <a href="/dev" className="ma-card ma-card-cta">
              <div className="ma-card-cta-icon">+</div>
              <h3>Build your own</h3>
              <p>Create and publish miniapps with the App Generator</p>
            </a>
          </div>
        ) : (
          <div className="ma-empty">
            <p>No apps match your search.</p>
          </div>
        )}
      </main>

      {/* ── App Overlay (iframe) ── */}
      {activeApp && (
        <div className="ma-overlay">
          <div className="ma-overlay-header">
            <div className="ma-overlay-app-info">
              <div
                className="ma-overlay-icon"
                style={{ background: `${CATEGORY_COLORS[activeApp.category] || '#64748b'}20`, color: CATEGORY_COLORS[activeApp.category] || '#64748b' }}
              >
                {activeApp.name.charAt(0)}
              </div>
              <span className="ma-overlay-name">{activeApp.name}</span>
            </div>
            <button className="ma-overlay-close" onClick={closeApp} aria-label="Close app">
              <CloseIcon />
            </button>
          </div>
          <div className="ma-overlay-body">
            {loadingApp ? (
              <div className="ma-overlay-loading">
                <div className="ma-pulse" />
                <p>Loading {activeApp.name}...</p>
              </div>
            ) : appHtml ? (
              <iframe
                ref={iframeRef}
                className="ma-iframe"
                sandbox="allow-scripts"
                srcDoc={appHtml}
                title={activeApp.name}
              />
            ) : null}
          </div>
        </div>
      )}

      {/* ── Error Toast ── */}
      {error && (
        <div className="ma-toast">
          <span>{error}</span>
          <button className="ma-toast-dismiss" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── App Card ────────────────────────────────── */

function AppCard({ app, onClick }: { app: RegistryEntry; onClick: () => void }) {
  const color = CATEGORY_COLORS[app.category] || '#64748b';

  return (
    <div className="ma-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      <div className="ma-card-icon" style={{ background: `${color}15`, color }}>
        {app.name.charAt(0)}
      </div>
      <h3 className="ma-card-name">{app.name}</h3>
      <p className="ma-card-desc">{app.description}</p>
      <div className="ma-card-meta">
        <span className="ma-card-author">@{app.author}</span>
        <span className="ma-card-cat" style={{ color, borderColor: `${color}40` }}>
          {app.category}
        </span>
      </div>
      <div className="ma-card-providers">
        {app.providers.map((p) => (
          <span key={p} className="ma-provider-badge" style={{ background: `${PROVIDER_COLORS[p] || '#64748b'}18`, color: PROVIDER_COLORS[p] || '#64748b', borderColor: `${PROVIDER_COLORS[p] || '#64748b'}30` }}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Icons ───────────────────────────────────── */

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
