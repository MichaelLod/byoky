'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MockScene =
  | 'walkthrough'
  | 'connect-chat'
  | 'cross-provider'
  | 'mobile-qr'
  | 'token-gift';

const ICON: Record<string, string> = {
  claude: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  mistral: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg',
  groq: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/groq.svg',
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

const NavWallet = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
  </svg>
);
const NavGift = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12v10H4V12" />
    <path d="M2 7h20v5H2z" />
    <path d="M12 22V7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);
const NavApps = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="9" height="9" rx="2" />
    <rect x="13" y="2" width="9" height="9" rx="2" />
    <rect x="2" y="13" width="9" height="9" rx="2" />
    <rect x="13" y="13" width="9" height="9" rx="2" />
  </svg>
);
const NavConnect = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);
const NavUsage = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 20V10" />
    <path d="M12 20V4" />
    <path d="M6 20v-6" />
  </svg>
);
const NavSettings = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

type ActiveNav = 'wallet' | 'gifts' | 'apps' | 'connect' | 'usage' | 'settings';

function MockShell({
  active,
  badge,
  title,
  children,
  overlay,
}: {
  active: ActiveNav;
  badge?: number;
  title?: string;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const items: Array<{ k: ActiveNav; Icon: () => ReactNode }> = [
    { k: 'wallet', Icon: NavWallet },
    { k: 'gifts', Icon: NavGift },
    { k: 'apps', Icon: NavApps },
    { k: 'connect', Icon: NavConnect },
    { k: 'usage', Icon: NavUsage },
    { k: 'settings', Icon: NavSettings },
  ];
  return (
    <div className="mock-popup">
      <div className="mock-header">
        <div className="mock-logo">
          <img src="/icon.svg" alt="" />
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
      <div className="mock-content">
        {title && <div className="mock-page-title">{title}</div>}
        {children}
      </div>
      {overlay}
    </div>
  );
}

function ProviderChip({ id, label, method = 'API Key' }: { id: keyof typeof ICON; label: string; method?: string }) {
  return (
    <div className="mock-card">
      <div className="mock-card-row">
        <div className="mock-pio">
          <img src={ICON[id]} alt="" />
        </div>
        <span className="mock-card-title">{label}</span>
        <span className="mock-card-rm">Remove</span>
      </div>
      <div className="mock-badges">
        <span className="mock-badge mock-badge-prov">{label.split(' ')[0]}</span>
        <span className="mock-badge mock-badge-meth">{method}</span>
      </div>
    </div>
  );
}

/* ─── Scene: Walkthrough (hero) ─── */

function WalkthroughScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 4, 2200);

  const showModal = step === 1 || step === 2;
  const filledKey = step === 2;
  const hasNew = step === 3;

  const overlay = (
    <>
      <div className={`mock-modal-backdrop ${showModal ? 'open' : ''}`}>
        <div className="mock-modal-sheet">
          <div className="mock-modal-header">
            <span>Add credential</span>
            <span className="mock-modal-x">×</span>
          </div>
          <div className="mock-modal-body">
            <div className="mock-field">
              <label>Provider</label>
              <div className="mock-input mock-input-row">
                <img src={ICON.openai} alt="" />
                <span>OpenAI</span>
              </div>
            </div>
            <div className="mock-field">
              <label>API key</label>
              <div className="mock-input mock-key">
                {filledKey ? '••••••••••••••••••••••sk-•••' : <span className="mock-caret" />}
              </div>
            </div>
            <button className={`mock-btn-primary ${filledKey ? 'ready' : ''}`} type="button" tabIndex={-1}>
              Save credential
            </button>
          </div>
        </div>
      </div>
      <div className="mock-fab" aria-hidden>+</div>
    </>
  );

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="wallet" title="Credentials" overlay={overlay}>
        <ProviderChip id="claude" label="Claude · personal" />
        {hasNew && <ProviderChip id="openai" label="OpenAI · work" />}
      </MockShell>
    </div>
  );
}

/* ─── Scene: Connect & Chat ─── */

function ConnectChatScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 4, 1600);

  const lines = [
    'Sure — here are three approaches:',
    '1. Stream chunks via fetch()',
    '2. Use Server-Sent Events',
    '3. Try a WebSocket relay',
  ];

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="connect" badge={1} title="Connected">
        <div className="mock-card mock-card-tight">
          <div className="mock-card-row">
            <div className="mock-app-fav">C</div>
            <div className="mock-card-text">
              <div className="mock-card-title">chat.example.com</div>
              <div className="mock-card-sub">streaming · gpt-4o</div>
            </div>
            <span className="mock-status-dot mock-status-ok" />
          </div>
        </div>
        <div className="mock-chat">
          <div className="mock-chat-bubble user">Explain streaming chat.</div>
          <div className="mock-chat-bubble bot">
            {lines.slice(0, step + 1).map((l, i) => (
              <div key={i}>{l}{i === step && <span className="mock-caret-inline" />}</div>
            ))}
          </div>
        </div>
      </MockShell>
    </div>
  );
}

/* ─── Scene: Cross-Provider Routing ─── */

function CrossProviderScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 3, 2000);

  const onRight = step >= 1;
  const swapped = step === 2;

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="apps" title="Groups">
        <div className="mock-groups">
          <div className="mock-group">
            <div className="mock-group-head">
              <img src={ICON.claude} alt="" />
              <span>Claude group</span>
            </div>
            <div className="mock-group-slot">
              {!onRight && (
                <div className={`mock-app-tile ${step === 0 ? 'idle' : ''}`}>
                  <div className="mock-app-fav lg">A</div>
                  <span>my-cli</span>
                </div>
              )}
            </div>
          </div>
          <div className="mock-group">
            <div className="mock-group-head">
              <img src={ICON.openai} alt="" />
              <span>GPT group</span>
            </div>
            <div className="mock-group-slot">
              {onRight && (
                <div className="mock-app-tile dropped">
                  <div className="mock-app-fav lg">A</div>
                  <span>my-cli</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={`mock-translate ${swapped ? 'show' : ''}`}>
          <span>Translating Anthropic → OpenAI</span>
        </div>
      </MockShell>
    </div>
  );
}

/* ─── Scene: Mobile QR Pairing ─── */

function MobileQRScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 3, 1900);
  const paired = step === 2;

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="connect" badge={paired ? 1 : undefined} title="Pair phone">
        <div className="mock-qr-wrap">
          <div className={`mock-qr ${paired ? 'paired' : ''}`}>
            <QRGrid />
            <div className="mock-qr-pulse" />
            {paired && <div className="mock-qr-check">✓</div>}
          </div>
          <div className="mock-qr-caption">
            {paired ? 'Phone connected' : 'Scan with the Byoky app'}
          </div>
        </div>
      </MockShell>
      <div className={`mock-phone ${step >= 1 ? 'scanning' : ''}`}>
        <div className="mock-phone-notch" />
        <div className="mock-phone-screen">
          <div className="mock-phone-cam" />
        </div>
      </div>
    </div>
  );
}

function QRGrid() {
  // Static-ish QR pattern.
  const cells = Array.from({ length: 81 }, (_, i) => {
    const r = (i * 9301 + 49297) % 233280;
    return r / 233280 > 0.55;
  });
  return (
    <div className="mock-qr-grid">
      {cells.map((on, i) => (
        <span key={i} className={on ? 'on' : ''} />
      ))}
      <div className="mock-qr-eye tl" />
      <div className="mock-qr-eye tr" />
      <div className="mock-qr-eye bl" />
    </div>
  );
}

/* ─── Scene: Token Gifts ─── */

function TokenGiftScene() {
  const ref = useRef<HTMLDivElement>(null);
  const step = useStepCycle(ref, 4, 1900);
  const presets = ['100K', '500K', '1M', '5M'];
  const selected = step >= 1 ? 1 : -1;
  const generated = step >= 2;
  const sent = step === 3;

  return (
    <div ref={ref} className="mock-stage">
      <MockShell active="gifts" title={generated ? 'Gift ready' : 'New gift'}>
        {!generated ? (
          <>
            <div className="mock-field">
              <label>Provider</label>
              <div className="mock-input mock-input-row">
                <img src={ICON.claude} alt="" />
                <span>Claude</span>
              </div>
            </div>
            <div className="mock-field">
              <label>Budget</label>
              <div className="mock-presets">
                {presets.map((p, i) => (
                  <span key={p} className={`mock-preset ${i === selected ? 'on' : ''}`}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <button className={`mock-btn-primary ${selected >= 0 ? 'ready' : ''}`} type="button" tabIndex={-1}>
              Generate gift link
            </button>
          </>
        ) : (
          <div className="mock-gift-success">
            <div className="mock-gift-check">✓</div>
            <div className="mock-gift-label">Gift link ready</div>
            <div className="mock-gift-link">
              byoky.com/gift/<span className="mock-gift-token">a7f2…b1c9</span>
            </div>
            <div className="mock-gift-row">
              <span className={`mock-pill ${sent ? 'on' : ''}`}>📋 Copied</span>
              <span className="mock-pill">500K tokens</span>
            </div>
          </div>
        )}
      </MockShell>
    </div>
  );
}

/* ─── Public component ─── */

export function ExtensionMock({
  scene,
  size = 'cell',
}: {
  scene: MockScene;
  size?: 'cell' | 'hero';
}) {
  return (
    <div className={`mock-frame mock-frame-${size}`} aria-hidden>
      {scene === 'walkthrough' && <WalkthroughScene />}
      {scene === 'connect-chat' && <ConnectChatScene />}
      {scene === 'cross-provider' && <CrossProviderScene />}
      {scene === 'mobile-qr' && <MobileQRScene />}
      {scene === 'token-gift' && <TokenGiftScene />}
    </div>
  );
}
