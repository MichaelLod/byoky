'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MuninnAlert, MuninnHead } from './Muninn';

export type MockScene =
  | 'walkthrough'
  | 'connect-chat'
  | 'cross-provider'
  | 'approval'
  | 'wallet';

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

/* ── Nav icons (16x16, as in the popup) ─────────────────────── */

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
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
);

type ActiveNav = 'wallet' | 'connect' | 'settings';

function MockNav({ active, badge }: { active: ActiveNav; badge?: number }) {
  const items: Array<{ k: ActiveNav; Icon: () => ReactNode }> = [
    { k: 'wallet', Icon: NavWallet },
    { k: 'connect', Icon: NavConnect },
    { k: 'settings', Icon: NavSettings },
  ];
  return (
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
  );
}

/* The popup: logo header, an optional status strip, content, a pinned footer. */
function MockShell({
  header,
  ruled,
  strip,
  children,
  overlay,
  footer,
}: {
  header: ReactNode;
  ruled?: boolean;
  strip?: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mock-popup">
      <div className={`mock-header${ruled ? ' mock-header-ruled' : ''}`}>
        <div className="mock-logo">
          <span className="brand-tile">b</span>
          <span>Byoky</span>
        </div>
        {header}
      </div>
      {strip}
      <div className="mock-content">{children}</div>
      {footer && <div className="mock-footer-pinned">{footer}</div>}
      {overlay}
    </div>
  );
}

function UnlockedStrip() {
  return (
    <div className="mock-strip">
      <span className="mock-status">
        <span className="mock-status-dot" />
        UNLOCKED · AUTO-LOCK 14:59
      </span>
      <MuninnHead width={42} />
    </div>
  );
}

/* ── Wallet: credentials and the request log ────────────────── */

const CREDENTIALS = [
  { tag: 'AN', name: 'Anthropic', method: 'Setup token', masked: 'sk-ant-oat…4f2c', usage: '7d: 86 req' },
  { tag: 'OA', name: 'OpenAI', method: 'API key', masked: 'sk-proj…91ab', usage: '7d: 23 req' },
  { tag: 'GE', name: 'Gemini', method: 'API key', masked: 'AIza…x7Qe', usage: 'no requests yet' },
];

function CredentialRow({ tag, name, method, masked, usage }: (typeof CREDENTIALS)[number]) {
  return (
    <div className="mock-row">
      <span className="mock-tile">{tag}</span>
      <div className="mock-row-main">
        <div className="mock-row-top">
          <span className="mock-row-name">{name}</span>
          <span className={`mock-row-tag${method === 'Setup token' ? ' accent' : ''}`}>{method}</span>
        </div>
        <div className="mock-row-sub">{masked} · {usage}</div>
      </div>
    </div>
  );
}

function WalletBody() {
  return (
    <>
      <div className="mock-title-row">
        <h2 className="mock-title">Credentials</h2>
        <span className="mock-link">[ LOCK ]</span>
      </div>
      {CREDENTIALS.map((c) => <CredentialRow key={c.tag} {...c} />)}
      <div className="mock-log">
        <div className="mock-log-title">RECENT REQUESTS</div>
        <div><span className="mock-dim">12:04</span> anthropic <span className="mock-ok">200</span> byoky.com/demo</div>
        <div><span className="mock-dim">12:03</span> openai    <span className="mock-ok">200</span> OpenClaw · bridge</div>
        <div><span className="mock-dim">11:58</span> anthropic <span className="mock-err">429</span> byoky.com/demo<span className="cursor">_</span></div>
      </div>
      <span className="mock-fab" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </span>
    </>
  );
}

function WalletScene() {
  return (
    <div className="mock-stage">
      <MockShell header={<MockNav active="wallet" badge={2} />} ruled strip={<UnlockedStrip />}>
        <WalletBody />
      </MockShell>
    </div>
  );
}

/* ── Approval: an app asks for providers ────────────────────── */

const REQUESTED = [
  { name: 'Anthropic', ready: true },
  { name: 'OpenAI', ready: true },
  { name: 'Google Gemini', ready: true },
  { name: 'Groq', ready: false },
];

function ApprovalBody() {
  return (
    <>
      <div className="mock-alert">
        <MuninnAlert size={88} />
        <div>
          <div className="mock-prompt">&gt; INCOMING CONNECTION<span className="cursor">_</span></div>
          <h2>Connection request</h2>
        </div>
      </div>
      <div className="mock-origin">
        <div className="mock-origin-host">byoky.com</div>
        <div className="mock-origin-sub">wants to connect to your wallet</div>
      </div>
      <div className="mock-label">Requesting access to</div>
      <ul className="mock-list">
        {REQUESTED.map((p) => (
          <li key={p.name}>
            <span>{p.name}</span>
            <span className={`mock-tag ${p.ready ? 'ok' : 'missing'}`}>
              {p.ready ? '[ KEY READY ]' : '[ NO KEY · REQUIRED ]'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mock-trust">
        <span className="mock-checkbox" />
        <span>Trust this site (auto-approve future connections)</span>
      </div>
    </>
  );
}

function ApprovalActions({ pressed }: { pressed: boolean }) {
  return (
    <div className="mock-actions">
      <button className="mock-btn mock-btn-secondary" type="button" tabIndex={-1}>Reject</button>
      <button className={`mock-btn mock-btn-primary${pressed ? ' pressed' : ''}`} type="button" tabIndex={-1}>Approve</button>
    </div>
  );
}

function ApprovalScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 3, 2500);
  // 0: approval request visible
  // 1: approve button pressed
  // 2: connected

  const overlay = step === 2 ? (
    <div className="mock-done">
      <span className="mock-done-check">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square"><polyline points="20 6 9 17 4 12" /></svg>
      </span>
      <div className="mock-done-title">Connected</div>
      <div className="mock-done-sub">byoky.com · 3 providers</div>
    </div>
  ) : undefined;

  return (
    <div ref={ref} className="mock-stage">
      <MockShell
        header={<span className="mock-pill">{step === 2 ? '0 PENDING' : '1 PENDING'}</span>}
        overlay={overlay}
        footer={<ApprovalActions pressed={step >= 1} />}
      >
        <ApprovalBody />
      </MockShell>
    </div>
  );
}

/* ── Connect & Chat: a connected app streaming through the wallet ── */

function ConnectChatScene() {
  const STREAM = "I'd recommend spinach, kale, and an iron supplement with vitamin C for absorption.";
  const LOOP_MS = 12000;
  const chatRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(0);
  const [streamIdx, setStreamIdx] = useState(0);
  const [streaming, setStreaming] = useState(false);

  // Phase: 0=idle, 1=user msg, 2=typing, 3=streaming, 4=done
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const d = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    const run = () => {
      setPhase(0); setStreamIdx(0); setStreaming(false);
      d(() => setPhase(1), 1500);
      d(() => setPhase(2), 2500);
      d(() => { setPhase(3); setStreaming(true); setStreamIdx(0); }, 3500);
      d(() => { setPhase(4); setStreaming(false); }, 10000);
      d(() => { setPhase(0); setStreamIdx(0); }, 11500);
    };
    run();
    const interval = setInterval(run, LOOP_MS);

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
  const live = phase >= 3 && streaming;

  return (
    <div className="mock-stage">
      <MockShell
        header={<MockNav active="connect" badge={1} />}
        ruled
        footer={
          <div className="mock-statusline">
            {live ? (
              <span className="mock-typing">
                <span className="mock-typing-dot" style={{ animationDelay: '0ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '150ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '300ms' }} />
              </span>
            ) : (
              <span className="mock-status"><span className="mock-status-dot" /></span>
            )}
            <span>{live ? 'Streaming via Byoky' : 'Connected via Byoky'}</span>
            <span className="mock-statusline-meta">{live ? `${tokens}K TOK` : 'CLAUDE 4'}</span>
          </div>
        }
      >
        <div className="mock-row">
          <span className="mock-tile">D</span>
          <div className="mock-row-main">
            <div className="mock-row-top">
              <span className="mock-row-name">byoky.com</span>
              <span className="mock-tag ok">[ LIVE ]</span>
            </div>
            <div className="mock-row-sub">via Claude · anthropic</div>
          </div>
        </div>

        <div ref={chatRef} className="mock-chat">
          <div className="mock-bubble user">Analyze my blood work</div>
          <div className="mock-bubble bot">Your iron is at 45 µg/dL. B12 looks healthy.</div>

          {phase >= 1 && (
            <div className="mock-bubble user">What should I eat to improve?</div>
          )}

          {phase === 2 && (
            <div className="mock-bubble bot">
              <span className="mock-typing">
                <span className="mock-typing-dot" style={{ animationDelay: '0ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '150ms' }} />
                <span className="mock-typing-dot" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          )}

          {phase >= 3 && (
            <div className="mock-bubble bot">
              {STREAM.slice(0, streamIdx)}
              {streaming && <span className="mock-caret-inline" />}
            </div>
          )}
        </div>
      </MockShell>
    </div>
  );
}

/* ── Walkthrough: browser demo + popup side by side ─────────── */

function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="mock-browser">
      <div className="mock-browser-bar">
        <span className="mock-browser-dot" />
        <span className="mock-browser-dot" />
        <span className="mock-browser-dot" />
        <div className="mock-browser-url">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
            <rect x="3" y="11" width="18" height="11" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{url}</span>
        </div>
      </div>
      <div className="mock-browser-body">{children}</div>
    </div>
  );
}

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
        <NavWallet />
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
          <span className="mock-status-dot" />
          Connected
        </span>
      </div>
      <div className="mock-chat-body">
        <div className="mock-bubble user">How do I stream chat completions?</div>
        <div className="mock-bubble bot">
          {lines.slice(0, visible).map((l, i) => (
            <div key={i}>
              {l}
              {i === visible - 1 && <span className="mock-caret-inline" />}
            </div>
          ))}
        </div>
      </div>
      <div className="mock-chat-input">
        <span>Ask anything…</span>
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
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
                <rect x="2" y="3" width="20" height="14" />
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
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="square">
                <polyline points="20 6 9 17 4 12" />
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
        <BrowserFrame url="byoky.com/demo">
          {inChat ? <ChatPanel step={chatStep} /> : <ConnectPanel pressed={buttonPressed} />}
        </BrowserFrame>
        {(showSdkModal || showSuccess) && <SdkModal state={showSuccess ? 'success' : 'connecting'} />}
      </div>
      <div className="mock-popup-side">
        {showApproval ? (
          <MockShell header={<span className="mock-pill">1 PENDING</span>} footer={<ApprovalActions pressed={step === 2} />}>
            <ApprovalBody />
          </MockShell>
        ) : (
          <MockShell header={<MockNav active="wallet" />} ruled strip={<UnlockedStrip />}>
            <WalletBody />
          </MockShell>
        )}
      </div>
    </div>
  );
}

/* ── Cross-Provider: one app, routed to another family ──────── */

const CROSS_PROVIDERS = [
  { tag: 'AN', name: 'Anthropic', model: 'claude-sonnet-4', shape: 'messages' },
  { tag: 'OA', name: 'OpenAI', model: 'gpt-4o', shape: 'chat.completions' },
  { tag: 'GE', name: 'Gemini', model: 'gemini-2.0-flash', shape: 'generateContent' },
  { tag: 'GR', name: 'Groq', model: 'llama-3.3-70b', shape: 'chat.completions' },
];

function CrossProviderScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, CROSS_PROVIDERS.length, 1900);
  const target = CROSS_PROVIDERS[step];
  const isCross = target.tag !== 'AN';

  return (
    <div ref={ref} className="mock-stage">
      <MockShell header={<MockNav active="connect" />} ruled strip={<UnlockedStrip />}>
        <h2 className="mock-title">Connected apps</h2>
        <div className="mock-row">
          <span className="mock-tile">C</span>
          <div className="mock-row-main">
            <div className="mock-row-name">claude-code-cli</div>
            <div className="mock-row-sub">written for the Anthropic API</div>
          </div>
        </div>

        <div className="mock-label">Routes through</div>
        <div className="mock-route">
          <span className="mock-route-end">Anthropic</span>
          <span className="mock-route-mid">
            <span className="mock-route-line" />
            <span className={`mock-route-badge ${isCross ? 'on' : 'pass'}`}>
              {isCross ? 'translate' : 'pass-through'}
            </span>
          </span>
          <span className={`mock-route-end${isCross ? ' on' : ''}`}>{target.name}</span>
        </div>

        <div className="mock-log">
          <span className="mock-ok">&gt;</span> {target.model} <span className="mock-dim">· {target.shape}</span><span className="cursor">_</span>
        </div>

        <div className="mock-route-picks">
          {CROSS_PROVIDERS.map((p, i) => (
            <span key={p.tag} className={`mock-tile${i === step ? ' on' : ''}`}>{p.tag}</span>
          ))}
        </div>
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
