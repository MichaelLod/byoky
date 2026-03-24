'use client';

import { useState, useCallback, useRef, useEffect, forwardRef } from 'react';
import { Byoky } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';
import { startDeviceFlow, pollForToken, getUser, createGist } from './github';
import type { GitHubUser } from './github';
import { generateApp } from './generator';
import type { GenerateResult, Message } from './generator';
import './dev.css';

/* ─── Helpers ──────────────────────────────────── */

function sanitizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'my-miniapp';
}

function downloadHtml(html: string, name: string): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── LocalStorage persistence ───────────────── */

const STORAGE_KEY = 'byoky-dev-project';

interface PersistedState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  miniappHtml: string | null;
  appName: string;
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

function savePersistedState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable
  }
}

/* ─── Main Component ──────────────────────────── */

export default function DevHub() {
  /* ── Connection state ── */
  const [walletSession, setWalletSession] = useState<ByokySession | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [githubToken, setGithubToken] = useState<string | null>(null);
  const [githubUser, setGithubUser] = useState<GitHubUser | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<{
    user_code: string;
    verification_uri: string;
  } | null>(null);

  /* ── Chat & Generation state ── */
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [generating, setGenerating] = useState(false);
  const [miniappHtml, setMiniappHtml] = useState<string | null>(null);
  const [appName, setAppName] = useState('');
  const [hydrated, setHydrated] = useState(false);

  /* ── Publish state ── */
  const [publishing, setPublishing] = useState(false);
  const [publishedGistUrl, setPublishedGistUrl] = useState<string | null>(null);

  /* ── UI state ── */
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [codeView, setCodeView] = useState<'code' | 'preview'>('code');
  const [copied, setCopied] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  /* ── Hydrate from localStorage on mount ── */
  useEffect(() => {
    const saved = loadPersistedState();
    if (saved.messages?.length) setMessages(saved.messages);
    if (saved.miniappHtml) setMiniappHtml(saved.miniappHtml);
    if (saved.appName) setAppName(saved.appName);
    setHydrated(true);
  }, []);

  /* ── Persist to localStorage on changes ── */
  useEffect(() => {
    if (!hydrated) return;
    savePersistedState({ messages, miniappHtml, appName });
  }, [hydrated, messages, miniappHtml, appName]);

  /* ── Refs ── */
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, generating]);

  useEffect(() => {
    if (!error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
    return () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); };
  }, [error]);

  /* ── Derived ── */
  const connectedProviders = walletSession
    ? Object.entries(walletSession.providers)
        .filter(([, v]) => v.available)
        .map(([k]) => k)
    : [];

  const hasMessages = messages.length > 0;

  /* ─── Wallet connect ────────────────────────── */

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

  /* ─── GitHub connect (device flow) ──────────── */

  const connectGitHub = useCallback(async () => {
    setError(null);
    try {
      const flow = await startDeviceFlow();
      setDeviceFlow({ user_code: flow.user_code, verification_uri: flow.verification_uri });
      window.open(flow.verification_uri, '_blank');
      const controller = new AbortController();
      abortRef.current = controller;
      const token = await pollForToken(flow.device_code, flow.interval, controller.signal);
      setGithubToken(token);
      const user = await getUser(token);
      setGithubUser(user);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'GitHub auth failed');
    } finally {
      setDeviceFlow(null);
      abortRef.current = null;
    }
  }, []);

  const cancelDeviceFlow = useCallback(() => {
    abortRef.current?.abort();
    setDeviceFlow(null);
  }, []);

  const disconnectGitHub = useCallback(() => {
    setGithubToken(null);
    setGithubUser(null);
  }, []);

  /* ─── Send chat message (generate/refine) ──── */

  const handleSend = useCallback(async () => {
    if (!walletSession || !inputValue.trim() || generating) return;

    const userText = inputValue.trim();
    setInputValue('');
    setGenerating(true);
    setError(null);

    const isFirst = messages.length === 0;
    const updatedMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(updatedMessages);

    try {
      const proxyFetch = walletSession.createFetch('anthropic');
      const previousMessages: Message[] = isFirst ? [] : messages;
      const res: GenerateResult = await generateApp(proxyFetch, userText, previousMessages.length > 0 ? previousMessages : undefined);

      setMiniappHtml(res.html);
      setCodeView('preview');
      if (isFirst) {
        setAppName(sanitizeName(userText.split(/\s+/).slice(0, 4).join('-')));
      }

      setMessages([...updatedMessages, { role: 'assistant', content: res.description }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generation failed';
      if (msg.includes('SESSION_EXPIRED') || msg.includes('expired session')) {
        setError('Session expired — reconnecting...');
        setWalletSession(null);
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
          setError(null);
        } catch {
          setError('Session expired. Please reconnect your wallet.');
        }
      } else {
        setError(msg);
      }
      setMessages(updatedMessages);
    } finally {
      setGenerating(false);
    }
  }, [walletSession, inputValue, generating, messages]);

  /* ─── Preview postMessage proxy ──────────────── */

  useEffect(() => {
    if (codeView !== 'preview' || !miniappHtml || !walletSession) return;

    const providerMap: Record<string, { available: boolean }> = {};
    for (const [id, info] of Object.entries(walletSession.providers)) {
      providerMap[id] = { available: (info as { available: boolean }).available };
    }

    const sendSession = () => {
      previewIframeRef.current?.contentWindow?.postMessage(
        { type: 'BYOKY_SESSION', providers: providerMap }, '*',
      );
    };

    const iframe = previewIframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', sendSession);
      sendSession();
    }

    const handler = async (event: MessageEvent) => {
      const iframeEl = previewIframeRef.current;
      if (!iframeEl?.contentWindow || !event.data || typeof event.data.type !== 'string') return;

      if (event.data.type === 'MINIAPP_READY') {
        iframeEl.contentWindow.postMessage({ type: 'BYOKY_SESSION', providers: providerMap }, '*');
      }

      if (event.data.type === 'BYOKY_API_REQUEST') {
        const { requestId, provider, url, method, headers, body, stream } = event.data;
        try {
          const proxyFetch = walletSession.createFetch(provider);
          const response = await proxyFetch(url, { method, headers, body });

          if (stream && response.body) {
            iframeEl.contentWindow.postMessage({ type: 'BYOKY_API_RESPONSE_START', requestId, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()) }, '*');
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              iframeEl.contentWindow?.postMessage({ type: 'BYOKY_API_RESPONSE_CHUNK', requestId, chunk: decoder.decode(value, { stream: true }) }, '*');
            }
            iframeEl.contentWindow?.postMessage({ type: 'BYOKY_API_RESPONSE_END', requestId }, '*');
          } else {
            const responseBody = await response.text();
            iframeEl.contentWindow.postMessage({ type: 'BYOKY_API_RESPONSE', requestId, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), body: responseBody }, '*');
          }
        } catch (err) {
          iframeEl.contentWindow?.postMessage({ type: 'BYOKY_API_RESPONSE_ERROR', requestId, error: err instanceof Error ? err.message : 'Request failed' }, '*');
        }
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      iframe?.removeEventListener('load', sendSession);
    };
  }, [codeView, miniappHtml, walletSession]);

  /* ─── Publish as MiniApp ────────────────────── */

  const handlePublish = useCallback(async () => {
    if (!githubToken || !githubUser || !miniappHtml) return;

    setPublishing(true);
    setError(null);

    try {
      const name = appName || 'my-miniapp';
      const gist = await createGist(githubToken, `${name}.html`, miniappHtml, `Byoky MiniApp: ${name}`);

      const entry = {
        id: `${githubUser.login}-${name}-${Date.now()}`,
        name: name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: messages.find((m) => m.role === 'assistant')?.content || 'A Byoky MiniApp',
        author: githubUser.login,
        gistId: gist.id,
        providers: ['anthropic'],
        category: 'other',
        publishedAt: new Date().toISOString(),
      };

      // Save to localStorage so /apps page picks it up
      const existing = JSON.parse(localStorage.getItem('byoky-user-apps') || '[]');
      existing.push(entry);
      localStorage.setItem('byoky-user-apps', JSON.stringify(existing));

      setPublishedGistUrl('/apps');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish miniapp');
    } finally {
      setPublishing(false);
    }
  }, [githubToken, githubUser, miniappHtml, appName, messages]);

  /* ─── Keyboard shortcuts ────────────────────── */

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /* ─── Render helpers ────────────────────────── */

  const renderCodeLines = (content: string) => {
    return content.split('\n').map((line, i) => (
      <span key={i} className="dh-code-line">{line}</span>
    ));
  };

  /* ─── Render ────────────────────────────────── */

  return (
    <div className="dh-container">
      {/* ── Top Bar ── */}
      <div className="dh-topbar">
        <div className="dh-topbar-left">
          <a href="/" className="dh-brand">Byoky</a>
          <span className="dh-topbar-title">MiniApp Creator</span>
          {(miniappHtml || messages.length > 0) && (
            <button
              className="dh-new-project-btn"
              onClick={() => {
                setMessages([]);
                setMiniappHtml(null);
                setAppName('');
                setPublishedGistUrl(null);
                localStorage.removeItem(STORAGE_KEY);
              }}
              title="Start a new miniapp"
            >
              + New
            </button>
          )}
        </div>
        <div className="dh-topbar-right">
          {/* Wallet pill */}
          {walletSession ? (
            <button className="dh-pill dh-pill-connected" onClick={disconnectWallet}>
              <span className="dh-dot dh-dot-green" />
              {connectedProviders.length} provider{connectedProviders.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <button className="dh-pill" onClick={connectWallet} disabled={walletConnecting}>
              {walletConnecting ? (
                <><span className="dh-spinner-sm" /> Connecting...</>
              ) : (
                'Connect Wallet'
              )}
            </button>
          )}

          {/* Browse apps link */}
          <a href="/apps" className="dh-pill" style={{ textDecoration: 'none' }}>
            Browse MiniApps
          </a>
        </div>
      </div>

      {/* ── Split Layout ── */}
      <div className="dh-split">
        {/* ── Chat Panel (left) ── */}
        <div className="dh-chat-panel">
          {!hasMessages && !generating ? (
            /* Empty state */
            <>
              <div className="dh-chat-empty">
                <div className="dh-chat-empty-icon">
                  <MiniAppIconLg />
                </div>
                <h3>What miniapp do you want to build?</h3>
                <p>Describe your idea and we'll generate a ready-to-publish miniapp using your AI keys.</p>
              </div>
              <ChatInput
                ref={textareaRef}
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                disabled={!walletSession || generating}
                walletConnected={!!walletSession}
                walletConnecting={walletConnecting}
                onConnectWallet={connectWallet}
                placeholder="e.g. A code review tool that gives funny feedback..."
              />
            </>
          ) : (
            /* Messages view */
            <>
              <div className="dh-chat-messages">
                {messages.map((msg, i) => (
                  <div key={i} className={`dh-msg dh-msg-${msg.role}`}>
                    <span className="dh-msg-label">
                      {msg.role === 'user' ? 'you' : 'Byoky'}
                    </span>
                    <div className="dh-msg-bubble">{msg.content}</div>
                  </div>
                ))}
                {generating && (
                  <div className="dh-msg dh-msg-assistant">
                    <span className="dh-msg-label">Byoky</span>
                    <div className="dh-typing">
                      <span className="dh-typing-dot" />
                      <span className="dh-typing-dot" />
                      <span className="dh-typing-dot" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <ChatInput
                ref={textareaRef}
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                onKeyDown={handleKeyDown}
                disabled={!walletSession || generating}
                walletConnected={!!walletSession}
                walletConnecting={walletConnecting}
                onConnectWallet={connectWallet}
                placeholder="Describe changes to your miniapp..."
              />
            </>
          )}
        </div>

        {/* ── Code Panel (right) ── */}
        <div className="dh-code-panel">
          {generating && !miniappHtml ? (
            <div className="dh-code-generating">
              <div className="dh-gen-pulse" />
              <p>Building your miniapp...</p>
            </div>
          ) : miniappHtml ? (
            <>
              <div className="dh-file-tabs">
                <button
                  className={`dh-file-tab${codeView === 'code' ? ' dh-file-tab-active' : ''}`}
                  onClick={() => setCodeView('code')}
                >
                  {appName || 'miniapp'}.html
                </button>
                <button
                  className={`dh-file-tab${codeView === 'preview' ? ' dh-file-tab-active' : ''}`}
                  onClick={() => setCodeView('preview')}
                >
                  Preview
                </button>
              </div>
              {codeView === 'preview' ? (
                <div className="dh-preview-area">
                  <iframe
                    ref={previewIframeRef}
                    className="dh-preview-iframe"
                    sandbox="allow-scripts"
                    srcDoc={miniappHtml}
                    title="MiniApp Preview"
                  />
                </div>
              ) : (
                <div className="dh-code-area">
                  <pre className="dh-code-block">
                    <code>{renderCodeLines(miniappHtml)}</code>
                  </pre>
                </div>
              )}

              {/* ── Next Steps Bar ── */}
              <div className="dh-next-steps">
                <div className="dh-next-steps-left">
                  {codeView !== 'preview' && (
                    <button className="dh-next-btn" onClick={() => setCodeView('preview')}>
                      <PlayIcon /> Preview
                    </button>
                  )}
                  <button className="dh-next-btn" onClick={() => downloadHtml(miniappHtml, appName || 'miniapp')}>
                    <DownloadIcon /> Download HTML
                  </button>
                </div>
                <div className="dh-next-steps-right">
                  {!githubUser ? (
                    deviceFlow ? (
                      <div className="dh-device-inline">
                        <code
                          className={`dh-device-code-sm${copied ? ' dh-device-code-copied' : ''}`}
                          onClick={() => {
                            navigator.clipboard.writeText(deviceFlow.user_code).then(() => {
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }).catch(() => {});
                          }}
                          title="Click to copy"
                          style={{ cursor: 'pointer' }}
                        >
                          {copied ? 'Copied!' : deviceFlow.user_code}
                        </code>
                        <span className="dh-spinner-sm" />
                        <button className="dh-link-btn" onClick={cancelDeviceFlow}>Cancel</button>
                      </div>
                    ) : (
                      <button className="dh-next-btn dh-next-btn-primary" onClick={connectGitHub}>
                        <GitHubIcon /> Connect GitHub to Publish
                      </button>
                    )
                  ) : publishedGistUrl ? (
                    <a href="/apps" className="dh-next-btn dh-next-btn-success">
                      View in MiniApps &#8599;
                    </a>
                  ) : (
                    <button className="dh-next-btn dh-next-btn-primary" onClick={handlePublish} disabled={publishing}>
                      {publishing ? <><span className="dh-spinner-sm" /> Publishing...</> : <><MiniAppIcon /> Publish to MiniApps</>}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="dh-code-empty">
              <div className="dh-code-empty-icon">
                <CodeIcon />
              </div>
              <p>Your miniapp will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Error Toast ── */}
      {error && (
        <div className="dh-toast">
          <span>{error}</span>
          <button className="dh-toast-dismiss" onClick={() => setError(null)}>
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Chat Input Component ─────────────────────── */

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  disabled: boolean;
  walletConnected: boolean;
  walletConnecting: boolean;
  onConnectWallet: () => void;
  placeholder: string;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput({ value, onChange, onSend, onKeyDown, disabled, walletConnected, walletConnecting, onConnectWallet, placeholder }, ref) {
    if (!walletConnected) {
      return (
        <div className="dh-chat-input-area">
          <button
            className="dh-connect-btn"
            onClick={onConnectWallet}
            disabled={walletConnecting}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
            </svg>
            {walletConnecting ? 'Connecting...' : 'Connect Wallet to Start'}
          </button>
        </div>
      );
    }

    return (
      <div className="dh-chat-input-area">
        <div className="dh-chat-input-wrap">
          <textarea
            ref={ref}
            className="dh-chat-textarea"
            rows={2}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
          />
          <button
            className="dh-chat-send"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
          >
            <ArrowIcon />
          </button>
        </div>
      </div>
    );
  },
);

/* ─── Icons ────────────────────────────────────── */

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function MiniAppIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function MiniAppIconLg() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
