'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const PROVIDER_ICONS: Record<string, string> = {
  claude: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
};

/* ─── Step 1: Install the Wallet ─── */

export function WalletPreview() {
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setActiveTab(t => (t + 1) % 3), 3000);
    return () => clearInterval(interval);
  }, []);

  const tabs = ['Wallet', 'Apps', 'Usage'];

  return (
    <div style={miniCard}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#FF4F00', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '8px', fontWeight: 800, color: '#fff' }}>B</span>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }}>Byoky</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
          <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Vault synced</span>
        </div>
      </div>

      {/* Nav tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '10px', background: '#f5f5f4', borderRadius: '6px', padding: '2px' }}>
        {tabs.map((t, i) => (
          <span key={t} style={{
            fontSize: '8px', padding: '4px 8px', borderRadius: '4px', flex: 1, textAlign: 'center',
            background: i === activeTab ? '#fff' : 'transparent',
            color: i === activeTab ? '#FF4F00' : 'var(--text-muted)',
            fontWeight: i === activeTab ? 700 : 400,
            boxShadow: i === activeTab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            transition: 'all 0.2s',
          }}>{t}</span>
        ))}
      </div>

      {/* Credentials label */}
      <div style={{ fontSize: '7px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Your API Keys</div>

      {/* Key cards */}
      {[
        { provider: 'claude', name: 'Claude', label: 'sk-ant-•••4f2a', status: 'Active' },
        { provider: 'openai', name: 'OpenAI', label: 'sk-proj-•••8k1m', status: 'Active' },
        { provider: 'gemini', name: 'Gemini', label: 'AIza•••Qx9p', status: 'Active' },
      ].map((key) => (
        <div key={key.provider} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 8px', background: '#fff',
          border: '1px solid #e5e5e5', borderRadius: '8px', marginBottom: '4px',
          transition: 'border-color 0.2s',
        }}>
          <img src={PROVIDER_ICONS[key.provider]} alt="" width={16} height={16} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '9px', fontWeight: 600, color: 'var(--text)' }}>{key.name}</div>
            <div style={{ fontSize: '7px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{key.label}</div>
          </div>
          <span style={{
            fontSize: '7px', fontWeight: 600, color: '#34d399',
            background: 'rgba(52,211,153,0.1)', padding: '2px 6px', borderRadius: '4px',
          }}>{key.status}</span>
        </div>
      ))}

      {/* Add key button */}
      <div style={{
        marginTop: '6px', padding: '5px', borderRadius: '6px',
        border: '1px dashed #ddd', textAlign: 'center',
        fontSize: '8px', color: 'var(--text-muted)', fontWeight: 500,
      }}>
        + Add API Key
      </div>

      <style>{animations}</style>
    </div>
  );
}

/* ─── Step 2: Connect to App ─── */

export function ConnectAppPreview() {
  const [phase, setPhase] = useState<'request' | 'selecting' | 'connected'>('request');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const d = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    if (phase === 'request') {
      d(() => { setPhase('selecting'); setChecked(new Set()); }, 3000);
    } else if (phase === 'selecting') {
      d(() => setChecked(new Set(['claude'])), 800);
      d(() => setChecked(new Set(['claude', 'openai'])), 1500);
      d(() => setPhase('connected'), 3500);
    } else if (phase === 'connected') {
      d(() => { setPhase('request'); setChecked(new Set()); }, 3000);
    }

    return () => timers.forEach(clearTimeout);
  }, [phase]);

  return (
    <div style={miniCard}>
      {phase === 'request' && (
        <div style={{ ...slideIn as any, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={miniHeader}>
            <WalletIcon /><span style={{ fontSize: '11px', fontWeight: 700, flex: 1 }}>Connection request</span>
            <span style={{ fontSize: '8px', fontWeight: 600, padding: '1px 6px', borderRadius: '10px', background: 'rgba(255,79,0,0.1)', color: '#FF4F00', textTransform: 'uppercase' }}>New</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', padding: '8px', background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#fff', border: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '14px' }}>🤖</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text)' }}>myaiapp.com</p>
              <p style={{ fontSize: '8px', color: 'var(--text-muted)' }}>wants to connect</p>
            </div>
          </div>
          <p style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>This app wants to use your AI providers through Byoky.</p>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <div style={btnGrey}>Deny</div>
            <div style={btnOrange}>Approve</div>
          </div>
        </div>
      )}
      {phase === 'selecting' && (
        <div style={{ ...slideIn as any, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={miniHeader}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            <span style={{ fontSize: '11px', fontWeight: 700, flex: 1 }}>Select providers</span>
          </div>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px' }}>Choose which providers to share:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
            {[{ k: 'gemini', l: 'Gemini' }, { k: 'claude', l: 'Claude' }, { k: 'openai', l: 'OpenAI' }].map(({ k, l }) => (
              <div key={k} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 8px', borderRadius: '8px', fontSize: '10px',
                background: checked.has(k) ? 'rgba(255,79,0,0.04)' : '#fafafa',
                border: `1px solid ${checked.has(k) ? 'rgba(255,79,0,0.25)' : '#e5e5e5'}`,
                transition: 'all 0.25s',
              }}>
                <MiniCheck on={checked.has(k)} />
                <img src={PROVIDER_ICONS[k]} alt="" width={14} height={14} />
                <span style={{ flex: 1, fontWeight: 500 }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            padding: '7px', borderRadius: '8px', fontSize: '10px', fontWeight: 600,
            textAlign: 'center', background: '#FF4F00', color: '#fff', width: '100%', marginTop: '8px',
            opacity: checked.size > 0 ? 1 : 0.4, transition: 'opacity 0.3s',
          }}>Connect</div>
        </div>
      )}
      {phase === 'connected' && (
        <div style={{ ...slideIn, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '8px' }}>
          <div style={checkCircle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>Connected</p>
          <div style={{ background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: '8px', padding: '8px 12px', width: '100%', textAlign: 'center' }}>
            <p style={{ fontSize: '8px', color: 'var(--text-muted)' }}>myaiapp.com can now use</p>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginTop: '4px' }}>
              {['claude', 'openai'].map(p => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <img src={PROVIDER_ICONS[p]} alt="" width={12} height={12} />
                  <span style={{ fontSize: '9px', fontWeight: 500, color: 'var(--text-secondary)' }}>{p === 'claude' ? 'Claude' : 'OpenAI'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <style>{animations}</style>
    </div>
  );
}

/* ─── Step 3: AI Just Works ─── */

export function ChatMiniPreview() {
  const STREAM = "I'd recommend spinach, kale, and an iron supplement with vitamin C for better absorption.";
  const LOOP_MS = 13000;

  const [stepsVisible, setStepsVisible] = useState(false);
  const [newMsgVisible, setNewMsgVisible] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [streamIdx, setStreamIdx] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [footerStreaming, setFooterStreaming] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const runAnimation = useCallback(() => {
    setStepsVisible(false);
    setNewMsgVisible(false);
    setShowTyping(false);
    setShowResponse(false);
    setStreamIdx(0);
    setStreaming(false);
    setCursorVisible(true);
    setFooterStreaming(false);
    if (chatRef.current) chatRef.current.scrollTop = 0;

    requestAnimationFrame(() => setStepsVisible(true));

    const timers: ReturnType<typeof setTimeout>[] = [];
    const d = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    d(() => { setNewMsgVisible(true); scroll(); }, 2500);
    d(() => { setShowTyping(true); scroll(); }, 3500);
    d(() => {
      setShowTyping(false);
      setShowResponse(true);
      setStreaming(true);
      setFooterStreaming(true);
      setStreamIdx(0);
      scroll();
    }, 4500);
    d(() => {
      setNewMsgVisible(false);
      setShowResponse(false);
      setStreaming(false);
      setFooterStreaming(false);
      setStreamIdx(0);
      setCursorVisible(true);
      if (chatRef.current) chatRef.current.scrollTop = 0;
    }, 11000);

    return () => timers.forEach(clearTimeout);
  }, [scroll]);

  useEffect(() => {
    const cleanup = runAnimation();
    const interval = setInterval(runAnimation, LOOP_MS);
    return () => { cleanup(); clearInterval(interval); };
  }, [runAnimation]);

  useEffect(() => {
    if (!streaming) return;
    if (streamIdx >= STREAM.length) {
      setStreaming(false);
      setCursorVisible(false);
      return;
    }
    const t = setTimeout(() => {
      setStreamIdx(i => i + 1);
      if (streamIdx % 5 === 0) scroll();
    }, 35);
    return () => clearTimeout(t);
  }, [streaming, streamIdx, scroll]);

  const tokens = ((streamIdx * 3) / 1000).toFixed(1);

  return (
    <div style={miniCard}>
      {/* Header */}
      <div style={{ ...miniHeader, opacity: stepsVisible ? 1 : 0, transition: 'opacity 0.35s ease' }}>
        <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: '#fafafa', border: '1px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '8px' }}>🤖</span>
        </div>
        <span style={{ fontSize: '11px', fontWeight: 600, flex: 1 }}>myaiapp.com</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <img src={PROVIDER_ICONS.claude} alt="" width={10} height={10} />
          <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Claude</span>
        </div>
      </div>

      {/* Chat */}
      <div ref={chatRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', flex: 1, overflowY: 'auto', scrollbarWidth: 'none', scrollBehavior: 'smooth' }}>
        <div style={{ opacity: stepsVisible ? 1 : 0, transition: 'opacity 0.35s ease 150ms' }}>
          <ChatRow user>Analyze my blood work</ChatRow>
        </div>
        <div style={{ opacity: stepsVisible ? 1 : 0, transition: 'opacity 0.35s ease 300ms' }}>
          <ChatRow ai>Your iron is at 45 µg/dL. B12 and folate look healthy.</ChatRow>
        </div>
        <div style={{ opacity: newMsgVisible ? 1 : 0, transform: newMsgVisible ? 'translateY(0)' : 'translateY(8px)', transition: 'all 0.3s ease' }}>
          <ChatRow user>What should I eat to improve?</ChatRow>
        </div>
        {showTyping && (
          <ChatRow ai>
            <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
              <Dot d={0} /><Dot d={150} /><Dot d={300} />
            </span>
          </ChatRow>
        )}
        {showResponse && (
          <ChatRow ai>
            {STREAM.slice(0, streamIdx)}
            {cursorVisible && <span style={{ display: 'inline-block', width: '2px', height: '10px', background: '#FF4F00', marginLeft: '2px', verticalAlign: 'middle', animation: 'spCursor 1s infinite' }} />}
          </ChatRow>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '6px', marginTop: '4px', borderTop: '1px solid #e5e5e5' }}>
        {!footerStreaming ? (
          <>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#34d399' }} />
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', flex: 1 }}>Connected via Byoky</span>
            <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Claude 4</span>
          </>
        ) : (
          <>
            <span style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
              <Dot d={0} s={3} /><Dot d={150} s={3} /><Dot d={300} s={3} />
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', flex: 1 }}>Streaming via Byoky</span>
            <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{tokens}K</span>
          </>
        )}
      </div>

      <style>{animations}</style>
    </div>
  );
}

/* ─── Chat row ─── */

function ChatRow({ children, user, ai }: { children: React.ReactNode; user?: boolean; ai?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
      <div style={{
        width: '16px', height: '16px', borderRadius: '50%',
        background: ai ? 'rgba(255,79,0,0.06)' : '#fafafa',
        border: `1px solid ${ai ? 'rgba(255,79,0,0.15)' : '#e5e5e5'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px',
      }}>
        {user && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
        {ai && <img src={PROVIDER_ICONS.claude} alt="" width={9} height={9} />}
      </div>
      <div style={{
        fontSize: '9px', lineHeight: 1.6, padding: '4px 8px', borderRadius: '6px',
        background: ai ? 'rgba(255,79,0,0.04)' : '#fafafa',
        border: `1px solid ${ai ? 'rgba(255,79,0,0.1)' : '#e5e5e5'}`,
        color: 'var(--text-secondary)', minWidth: 0, flex: ai ? 1 : undefined, textAlign: 'left',
      }}>
        {children}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function WalletIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF4F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
}

function MiniCheck({ on }: { on: boolean }) {
  return (
    <div style={{
      width: '14px', height: '14px', borderRadius: '4px',
      border: `1.5px solid ${on ? '#FF4F00' : '#ddd'}`,
      background: on ? '#FF4F00' : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.25s', flexShrink: 0,
    }}>
      {on && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
  );
}

function Dot({ d, s = 4 }: { d: number; s?: number }) {
  return <span style={{ width: `${s}px`, height: `${s}px`, borderRadius: '50%', background: '#FF4F00', animation: 'spBounce 0.8s ease-in-out infinite', animationDelay: `${d}ms` }} />;
}

/* ─── Styles ─── */

const miniCard: React.CSSProperties = {
  width: '240px', height: '260px', background: '#fff', border: '1px solid #e5e5e5',
  borderRadius: '14px', padding: '14px',
  boxShadow: '0 4px 16px rgba(0,0,0,0.04), 0 1px 4px rgba(0,0,0,0.02)',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
};

const miniHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  paddingBottom: '8px', borderBottom: '1px solid #e5e5e5',
};

const slideIn: React.CSSProperties = { animation: 'spSlideIn 0.3s ease-out' };

const btnOrange: React.CSSProperties = {
  flex: 1, padding: '7px', borderRadius: '8px', fontSize: '10px',
  fontWeight: 700, textAlign: 'center', background: '#FF4F00', color: '#fff',
};

const btnGrey: React.CSSProperties = {
  flex: 1, padding: '7px', borderRadius: '8px', fontSize: '10px',
  fontWeight: 500, textAlign: 'center', background: '#fafafa',
  border: '1px solid #e5e5e5', color: 'var(--text-secondary)',
};

const checkCircle: React.CSSProperties = {
  width: '32px', height: '32px', borderRadius: '50%',
  background: 'rgba(34,197,94,0.08)', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};

const animations = `
  @keyframes spFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spSlideIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes spBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-3px); } }
  @keyframes spCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
`;
