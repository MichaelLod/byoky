'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MockScene =
  | 'walkthrough'
  | 'connect-chat'
  | 'cross-provider'
  | 'approval'
  | 'wallet';

const ICON: Record<string, string> = {
  anthropic: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/anthropic.svg',
  claude: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  groq: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/groq.svg',
  mistral: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg',
};

function useStepCycle(
  rootRef: React.RefObject<HTMLElement | null>,
  stepCount: number,
  ms: number,
) {
  const [step, setStep] = useState(0);
  const activeRef = useRef(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { activeRef.current = entry.isIntersecting; },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootRef]);
  useEffect(() => {
    const id = setInterval(() => {
      if (activeRef.current) setStep((s) => (s + 1) % stepCount);
    }, ms);
    return () => clearInterval(id);
  }, [stepCount, ms]);
  return step;
}

/* ── Nav icons (sized to match real popup at 16x16) ─────────── */

const NavWallet = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);
const NavConnect = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);
const NavSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

type ActiveNav = 'wallet' | 'connect' | 'settings';

function MockShell({
  active,
  badge,
  children,
  overlay,
  footer,
}: {
  active: ActiveNav;
  badge?: number;
  children: ReactNode;
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  const items: Array<{ k: ActiveNav; Icon: () => ReactNode }> = [
    { k: 'wallet', Icon: NavWallet },
    { k: 'connect', Icon: NavConnect },
    { k: 'settings', Icon: NavSettings },
  ];
  return (
    <div className="mock-popup">
      <div className="mock-header">
        <div className="mock-logo">
          <span className="mock-logo-mark">
            <span>β</span>
          </span>
          <span>Byoky</span>
        </div>
        <nav className="mock-nav">
          {items.map(({ k, Icon }) => (
            <button key={k} className={k === active ? 'active' : ''} type="button" tabIndex={-1} aria-hidden>
              <Icon />
              {k === 'connect' && badge !== undefined && badge > 0 && (
                <span className="mock-nav-badge">{badge}</span>
              )}
            </button>
          ))}
        </nav>
      </div>
      <div className="mock-content">{children}</div>
      {footer && <div className="mock-footer-pinned">{footer}</div>}
      {overlay}
    </div>
  );
}

/* ── Reusable popup pieces matching real extension ───────────── */

function CredentialCard({
  providerId, providerName, label, method, added,
}: {
  providerId: keyof typeof ICON;
  providerName: string;
  label: string;
  method: 'API Key' | 'Setup Token';
  added: string;
}) {
  return (
    <div className="mock-card mock-cred-card">
      <div className="mock-card-row">
        <div className="mock-pio">
          <img src={ICON[providerId]} alt="" />
        </div>
        <span className="mock-card-title">{label}</span>
        <span className="mock-card-rm-circle" aria-hidden>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </span>
      </div>
      <div className="mock-badges">
        <span className="mock-badge mock-badge-prov">{providerName}</span>
        <span className={`mock-badge ${method === 'Setup Token' ? 'mock-badge-token' : 'mock-badge-meth'}`}>{method}</span>
      </div>
      <div className="mock-card-sub">Added {added}</div>
    </div>
  );
}

function ApprovalRow({
  providerId, providerName, state,
}: {
  providerId: keyof typeof ICON;
  providerName: string;
  state: 'ok' | 'missing';
}) {
  return (
    <div className="mock-approval-row">
      <span className="mock-badge mock-badge-prov">{providerName}</span>
      {state === 'missing' && <span className="mock-no-cred">no key added</span>}
    </div>
  );
}

/* ── Browser frame (hero left side) ─────────────────────────── */

function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="mock-browser">
      <div className="mock-browser-bar">
        <span className="mock-browser-dot mock-browser-dot-r" />
        <span className="mock-browser-dot mock-browser-dot-y" />
        <span className="mock-browser-dot mock-browser-dot-g" />
        <div className="mock-browser-url">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{url}</span>
        </div>
      </div>
      <div className="mock-browser-body">{children}</div>
    </div>
  );
}

/* ── Hero scene ─────────────────────────────────────────────── */

function ConnectPanel({ pressed }: { pressed: boolean }) {
  return (
    <div className="mock-connect-panel">
      <div className="mock-connect-flow">
        <div className="mock-flow-node">Your Keys</div>
        <div className="mock-flow-line" />
        <div className="mock-flow-node mock-flow-node-on">Byoky Wallet</div>
        <div className="mock-flow-line" />
        <div className="mock-flow-node">AI API</div>
      </div>
      <h3 className="mock-connect-title">Connect your Byoky wallet</h3>
      <p className="mock-connect-sub">
        This demo uses your own keys to chat with Claude, GPT-4o, Gemini, and 10 more providers.
      </p>
      <button className={`mock-connect-btn ${pressed ? 'pressed' : ''}`} type="button" tabIndex={-1}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
        Connect Wallet
      </button>
      <div className="mock-connect-features">
        <div><span className="mock-check-tiny">✓</span>Keys stay encrypted in your wallet</div>
        <div><span className="mock-check-tiny">✓</span>This app never sees your API keys</div>
      </div>
    </div>
  );
}

function ChatPanel({ step }: { step: number }) {
  // step within chat phase, 0..3
  const lines = [
    'Sure — streaming with byoky is the same shape',
    'as a normal fetch call. The wallet proxies the',
    'request and forwards SSE chunks back through',
    'the runtime. No keys touch your server.',
  ];
  const visible = Math.min(lines.length, step + 1);
  return (
    <div className="mock-chat-panel">
      <div className="mock-chat-tabs">
        <span className="mock-chat-tab active">Chat</span>
        <span className="mock-chat-tab">Tools</span>
        <span className="mock-chat-tab">Structured</span>
        <span className="mock-chat-conn">
          <span className="mock-status-ok-dot" />
          Connected
        </span>
      </div>
      <div className="mock-chat-body">
        <div className="mock-chat-msg user">
          <span className="mock-chat-avatar">You</span>
          <div className="mock-chat-bubble user">How do I stream chat completions?</div>
        </div>
        <div className="mock-chat-msg bot">
          <span className="mock-chat-avatar bot">
            <img src={ICON.claude} alt="" />
          </span>
          <div className="mock-chat-bubble bot">
            {lines.slice(0, visible).map((l, i) => (
              <div key={i}>
                {l}
                {i === visible - 1 && <span className="mock-caret-inline" />}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mock-chat-input">
        <span className="mock-chat-input-text">Ask anything…</span>
        <span className="mock-chat-send">↑</span>
      </div>
    </div>
  );
}

function SdkModal({ state }: { state: 'connecting' | 'success' }) {
  return (
    <div className="mock-sdk-modal-overlay">
      <div className="mock-sdk-modal">
        {state === 'connecting' ? (
          <>
            <div className="mock-sdk-icon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="mock-sdk-h">Connecting…</div>
            <div className="mock-sdk-status">
              <span className="mock-sdk-spinner" />
              Waiting for wallet approval
            </div>
          </>
        ) : (
          <>
            <div className="mock-sdk-check">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="mock-sdk-h">Connected!</div>
          </>
        )}
      </div>
    </div>
  );
}

function WalkthroughScene() {
  const ref = useRef<HTMLDivElement>(null);
  // 7-step loop; tighter pacing on briefer states.
  const step = useStepCycle(ref, 7, 1700);
  // 0: idle (Connect button + wallet dashboard)
  // 1: button pressed → SDK modal "Connecting…", popup transitions to approval
  // 2: approval visible, modal still waiting
  // 3: Approve clicked → modal "Connected!" briefly, popup back to dashboard
  // 4-6: chat playground in browser, message streams line by line

  const inChat = step >= 4;
  const showSdkModal = step === 1 || step === 2;
  const showSuccess = step === 3;
  const showApproval = step === 1 || step === 2;
  const buttonPressed = step >= 1;
  const chatStep = Math.max(0, step - 4);

  return (
    <div ref={ref} className="mock-stage mock-stage-split">
      <div className="mock-browser-side">
        <BrowserFrame url="demo.byoky.com">
          {inChat ? <ChatPanel step={chatStep} /> : <ConnectPanel pressed={buttonPressed} />}
        </BrowserFrame>
        {(showSdkModal || showSuccess) && <SdkModal state={showSuccess ? 'success' : 'connecting'} />}
      </div>
      <div className="mock-popup-side">
        {showApproval ? (
          <MockShell active="connect" badge={1}>
            <h2 className="mock-page-title">Connection Request</h2>
            <div className="mock-approval-card">
              <div className="mock-approval-icon">D</div>
              <div className="mock-approval-origin">demo.byoky.com</div>
              <div className="mock-approval-subtitle">wants to connect to your wallet</div>
            </div>
            <div className="mock-approval-section">
              <div className="mock-approval-section-label">Requesting access to:</div>
              <div className="mock-approval-list">
                <ApprovalRow providerId="anthropic" providerName="Anthropic" state="ok" />
                <ApprovalRow providerId="openai" providerName="OpenAI" state="ok" />
                <ApprovalRow providerId="gemini" providerName="Google Gemini" state="ok" />
                <ApprovalRow providerId="groq" providerName="Groq" state="missing" />
              </div>
            </div>
            <label className="mock-trust">
              <span className="mock-checkbox" />
              <span>Trust this site (auto-approve future connections)</span>
            </label>
            <div className="mock-approval-actions">
              <button className="mock-btn mock-btn-secondary" type="button" tabIndex={-1}>Reject</button>
              <button className={`mock-btn mock-btn-primary ${step === 2 ? 'pressed' : ''}`} type="button" tabIndex={-1}>Approve</button>
            </div>
            <div className="mock-approval-full">https://demo.byoky.com</div>
          </MockShell>
        ) : (
          <MockShell active="wallet">
            <div className="mock-page-title-row">
              <h2 className="mock-page-title">Credentials</h2>
              <span className="mock-text-link">Lock</span>
            </div>
            <CredentialCard
              providerId="anthropic"
              providerName="Anthropic"
              label="My Anthropic key"
              method="Setup Token"
              added="4/16/2026"
            />
            <CredentialCard
              providerId="openai"
              providerName="OpenAI"
              label="My OpenAI key"
              method="API Key"
              added="4/16/2026"
            />
            <CredentialCard
              providerId="gemini"
              providerName="Google Gemini"
              label="My Gemini key"
              method="API Key"
              added="4/16/2026"
            />
          </MockShell>
        )}
      </div>
    </div>
  );
}

/* ── Connect & Chat (cell) ─────────────────────────────────── */

function ConnectChatScene() {
  const STREAM = "I'd recommend spinach, kale, and an iron supplement with vitamin C for absorption.";
  const LOOP_MS = 12000;
  const ref = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const [streamIdx, setStreamIdx] = useState(0);
  const [streaming, setStreaming] = useState(false);

  // Phase: 0=idle, 1=user msg, 2=typing, 3=streaming, 4=done
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const d = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    setPhase(0); setStreamIdx(0); setStreaming(false);
    d(() => setPhase(1), 1500);
    d(() => setPhase(2), 2500);
    d(() => { setPhase(3); setStreaming(true); setStreamIdx(0); }, 3500);
    d(() => { setPhase(4); setStreaming(false); }, 10000);
    d(() => { setPhase(0); setStreamIdx(0); }, 11500);

    const interval = setInterval(() => {
      setPhase(0); setStreamIdx(0); setStreaming(false);
      d(() => setPhase(1), 1500);
      d(() => setPhase(2), 2500);
      d(() => { setPhase(3); setStreaming(true); setStreamIdx(0); }, 3500);
      d(() => { setPhase(4); setStreaming(false); }, 10000);
      d(() => { setPhase(0); setStreamIdx(0); }, 11500);
    }, LOOP_MS);

    return () => { timers.forEach(clearTimeout); clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!streaming) return;
    if (streamIdx >= STREAM.length) { setStreaming(false); return; }
    const t = setTimeout(() => {
      setStreamIdx(i => i + 1);
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
    }, 40);
    return () => clearTimeout(t);
  }, [streaming, streamIdx]);

  const tokens = ((streamIdx * 3) / 1000).toFixed(1);

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="connect" badge={1} footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderTop: '1px solid var(--mp-border, #e7e5e4)' }}>
          {phase >= 3 && streaming ? (
            <>
              <span style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                <span className="mock-typing-dot" style={{ width: '3px', height: '3px', animationDelay: '0ms' }} />
                <span className="mock-typing-dot" style={{ width: '3px', height: '3px', animationDelay: '150ms' }} />
                <span className="mock-typing-dot" style={{ width: '3px', height: '3px', animationDelay: '300ms' }} />
              </span>
              <span style={{ fontSize: '8px', color: 'var(--mp-text-3, #a8a29e)', flex: 1, marginLeft: '2px' }}>Streaming via Byoky</span>
              <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--mp-text-3, #a8a29e)' }}>{tokens}K</span>
            </>
          ) : (
            <>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#34d399' }} />
              <span style={{ fontSize: '8px', color: 'var(--mp-text-3, #a8a29e)', flex: 1, marginLeft: '2px' }}>Connected via Byoky</span>
              <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--mp-text-3, #a8a29e)' }}>Claude 4</span>
            </>
          )}
        </div>
      }>
        {/* App header */}
        <div className="mock-card" style={{ marginBottom: '6px' }}>
          <div className="mock-card-row">
            <div className="mock-app-fav">D</div>
            <div className="mock-card-text">
              <div className="mock-card-title">demo.byoky.com</div>
              <div className="mock-card-sub-tight">via Claude</div>
            </div>
            <span className="mock-status-dot mock-status-ok" />
          </div>
        </div>

        {/* Chat area */}
        <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div className="mock-chat-bubble user small">Analyze my blood work</div>
          <div className="mock-chat-bubble bot small">Your iron is at 45 µg/dL. B12 looks healthy.</div>

          {phase >= 1 && (
            <div className="mock-chat-bubble user small" style={{ animation: 'mock-fade-in 0.2s ease-out' }}>
              What should I eat to improve?
            </div>
          )}

          {phase === 2 && (
            <div className="mock-chat-bubble bot small" style={{ animation: 'mock-fade-in 0.15s ease-out' }}>
              <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                <span className="mock-typing-dot" style={{ animationDelay: '0ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '150ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}

          {phase >= 3 && (
            <div className="mock-chat-bubble bot small" style={{ animation: 'mock-fade-in 0.15s ease-out' }}>
              {STREAM.slice(0, streamIdx)}
              {streaming && <span className="mock-caret-inline" />}
            </div>
          )}
        </div>
      </MockShell>
    </div>
  );
}

/* ── Cross-Provider (cell) — translation focus ─────────────── */

const CROSS_PROVIDERS = [
  { id: 'anthropic' as const, name: 'Anthropic', model: 'claude-sonnet-4', shape: 'messages' },
  { id: 'openai' as const, name: 'OpenAI', model: 'gpt-4o', shape: 'chat.completions' },
  { id: 'gemini' as const, name: 'Google Gemini', model: 'gemini-2.0-flash', shape: 'generateContent' },
  { id: 'groq' as const, name: 'Groq', model: 'llama-3.3-70b', shape: 'chat.completions' },
];

function CrossProviderScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, CROSS_PROVIDERS.length, 1900);
  const target = CROSS_PROVIDERS[step];
  const isCross = target.id !== 'anthropic';

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="connect">
        <h2 className="mock-page-title">Connected Apps</h2>
        <div className="mock-card mock-cross-card">
          <div className="mock-card-row">
            <div className="mock-app-fav lg">C</div>
            <div className="mock-card-text">
              <div className="mock-card-title">claude-code-cli</div>
              <div className="mock-card-sub-tight">written for Anthropic API</div>
            </div>
          </div>
        </div>

        <div className="mock-section-label">Routes through</div>
        <div className="mock-cross-route">
          <div className="mock-cross-from">
            <img src={ICON.anthropic} alt="" />
            <span>Anthropic</span>
          </div>
          <div className="mock-cross-arrow">
            <span className="mock-cross-line" />
            <span className={`mock-cross-trans ${isCross ? 'on' : 'pass'}`}>
              {isCross ? 'translate' : 'pass-through'}
            </span>
          </div>
          <div className={`mock-cross-to ${isCross ? 'cross' : ''}`}>
            <img src={ICON[target.id]} alt="" />
            <span>{target.name}</span>
          </div>
        </div>

        <div className="mock-cross-meta">
          <span className="mock-mono">{target.model}</span>
          <span className="mock-mono dim">·</span>
          <span className="mock-mono dim">{target.shape}</span>
        </div>

        <div className="mock-cross-providers">
          {CROSS_PROVIDERS.map((p, i) => (
            <span key={p.id} className={`mock-cross-pill ${i === step ? 'on' : ''}`}>
              <img src={ICON[p.id]} alt="" />
            </span>
          ))}
        </div>
      </MockShell>
    </div>
  );
}

/* ── Wallet dashboard (standalone popup) ──────────────────── */

function WalletScene() {
  return (
    <div className="mock-stage">
      <MockShell active="wallet">
        <div className="mock-page-title-row">
          <h2 className="mock-page-title">Credentials</h2>
          <span className="mock-text-link">Lock</span>
        </div>
        <CredentialCard
          providerId="anthropic"
          providerName="Anthropic"
          label="My Anthropic key"
          method="Setup Token"
          added="4/16/2026"
        />
        <CredentialCard
          providerId="openai"
          providerName="OpenAI"
          label="My OpenAI key"
          method="API Key"
          added="4/16/2026"
        />
        <CredentialCard
          providerId="gemini"
          providerName="Google Gemini"
          label="My Gemini key"
          method="API Key"
          added="4/16/2026"
        />
        <button className="mock-btn mock-btn-primary" type="button" tabIndex={-1} style={{ width: '100%', marginTop: '8px', opacity: 1 }}>+ Add API Key</button>
      </MockShell>
    </div>
  );
}

/* ── Approval (standalone popup) ──────────────────────────── */

function ApprovalScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 3, 2500);
  // 0: approval request visible
  // 1: approve button pressed
  // 2: connected overlay with blur

  const overlay = step === 2 ? (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'rgba(255,255,255,0.7)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '6px',
      animation: 'mock-fade-in 0.2s ease-out',
    }}>
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%',
        background: 'rgba(34,197,94,0.1)', border: '2px solid #22c55e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      </div>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1c1917' }}>Connected!</div>
      <div style={{ fontSize: '10px', color: '#57534e' }}>demo.byoky.com</div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
        <img src={ICON.anthropic} alt="" style={{ width: '16px', height: '16px' }} />
        <img src={ICON.openai} alt="" style={{ width: '16px', height: '16px' }} />
        <img src={ICON.gemini} alt="" style={{ width: '16px', height: '16px' }} />
      </div>
    </div>
  ) : undefined;

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="connect" badge={step === 0 ? 1 : undefined} overlay={overlay} footer={
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--mp-border, #e7e5e4)' }}>
          <div className="mock-approval-actions" style={{ gap: '8px', display: 'flex' }}>
            <button className="mock-btn mock-btn-secondary" type="button" tabIndex={-1} style={{ flex: 1, padding: '8px', fontSize: '11px' }}>Reject</button>
            <button className={`mock-btn mock-btn-primary ${step >= 1 ? 'pressed' : ''}`} type="button" tabIndex={-1} style={{ flex: 1, padding: '8px', fontSize: '11px' }}>Approve</button>
          </div>
          <div className="mock-approval-full" style={{ marginTop: '6px', textAlign: 'center' }}>https://demo.byoky.com</div>
        </div>
      }>
        <h2 className="mock-page-title">Connection Request</h2>
        <div className="mock-approval-card">
          <div className="mock-approval-icon">D</div>
          <div className="mock-approval-origin">demo.byoky.com</div>
          <div className="mock-approval-subtitle">wants to connect to your wallet</div>
        </div>
        <div className="mock-approval-section">
          <div className="mock-approval-section-label">Requesting access to:</div>
          <div className="mock-approval-list">
            <ApprovalRow providerId="anthropic" providerName="Anthropic" state="ok" />
            <ApprovalRow providerId="openai" providerName="OpenAI" state="ok" />
            <ApprovalRow providerId="gemini" providerName="Google Gemini" state="ok" />
            <ApprovalRow providerId="groq" providerName="Groq" state="missing" />
          </div>
        </div>
        <label className="mock-trust">
          <span className="mock-checkbox" />
          <span>Trust this site (auto-approve future connections)</span>
        </label>
      </MockShell>
    </div>
  );
}

/* ── Public component ───────────────────────────────────────── */

export function ExtensionMock({
  scene,
  size = 'cell',
}: {
  scene: MockScene;
  size?: 'cell' | 'hero';
}) {
  return (
    <div className={`mock-frame mock-frame-${size} mock-scene-${scene}`} aria-hidden>
      {scene === 'walkthrough' && <WalkthroughScene />}
      {scene === 'connect-chat' && <ConnectChatScene />}
      {scene === 'cross-provider' && <CrossProviderScene />}
      {scene === 'approval' && <ApprovalScene />}
      {scene === 'wallet' && <WalletScene />}
    </div>
  );
}
