'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const PROVIDER_ICONS: Record<string, string> = {
  claude: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
};

const STREAM_TEXT = "Your iron levels are slightly low at 45 µg/dL. I'd recommend increasing leafy greens like spinach and kale, and considering an iron supplement with vitamin C to aid absorption. Your B12 and folate levels look healthy. Let me create a personalized meal plan based on these results…";

/* ─── Step 1: Get a Wallet ─── */

export function WalletPreview() {
  const [balance, setBalance] = useState(12.50);

  useEffect(() => {
    // Simulate small charges ticking down
    const interval = setInterval(() => {
      setBalance((b) => {
        const next = b - 0.01;
        return next < 12.0 ? 12.50 : Math.round(next * 100) / 100;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={miniCard}>
      {/* Mini balance card */}
      <div style={{ background: '#1a1a2e', borderRadius: '8px', padding: '10px 12px', color: '#fff', marginBottom: '8px', position: 'relative', overflow: 'hidden' }}>
        {/* Subtle orange glow */}
        <div style={{
          position: 'absolute', top: '-20px', right: '-20px',
          width: '80px', height: '80px',
          background: 'radial-gradient(circle, rgba(255,79,0,0.25) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        {/* Dot matrix overlay */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.06,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
          backgroundSize: '8px 8px',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', position: 'relative' }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.02em' }}>Byoky</span>
          <span style={{ fontSize: '8px', opacity: 0.7, background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: '4px' }}>Wallet</span>
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em', transition: 'all 0.3s', position: 'relative' }}>${balance.toFixed(2)}</div>
        <div style={{ fontSize: '7px', opacity: 0.6, marginTop: '2px', position: 'relative' }}>Auto top-up enabled</div>
      </div>

      {/* Mini nav tabs */}
      <div style={{ display: 'flex', gap: '2px', marginBottom: '6px' }}>
        {['Wallet', 'Apps', 'Usage'].map((t, i) => (
          <span key={t} style={{ fontSize: '8px', padding: '3px 6px', borderRadius: '4px', background: i === 0 ? 'rgba(255,79,0,0.08)' : 'transparent', color: i === 0 ? 'var(--teal)' : 'var(--text-muted)', fontWeight: i === 0 ? 600 : 400 }}>{t}</span>
        ))}
      </div>

      {/* Mini connected apps */}
      <div style={{ fontSize: '7px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>Connected</div>
      {['DemoChat', 'CodeAssist'].map((app) => (
        <div key={app} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '3px 5px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '5px', marginBottom: '2px' }}>
          <div style={{ width: '14px', height: '14px', borderRadius: '4px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7px', fontWeight: 700, color: 'var(--teal)' }}>{app[0]}</div>
          <span style={{ fontSize: '9px', fontWeight: 500, flex: 1 }}>{app}</span>
          <span style={{ fontSize: '7px', color: 'var(--text-muted)' }}>$0.02</span>
        </div>
      ))}

      {/* Mini transaction */}
      <div style={{ fontSize: '7px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '4px', marginBottom: '2px' }}>Recent</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 5px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '5px', fontSize: '8px' }}>
        <span>Gemini</span>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>-$0.01</span>
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
            <WalletIcon /><span style={{ fontSize: '11px', fontWeight: 700, flex: 1 }}>New request</span>
            <span style={{ fontSize: '8px', fontWeight: 600, padding: '1px 6px', borderRadius: '10px', background: 'rgba(255,79,0,0.1)', color: 'var(--teal)', textTransform: 'uppercase' }}>New</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', padding: '6px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}><img src="https://agnostic.health/logo.png" alt="" style={{ width: '24px', height: '24px', objectFit: 'contain' }} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '10px', fontWeight: 600 }}>agnostic.health</p>
              <p style={{ fontSize: '8px', color: 'var(--text-muted)' }}>AI health assistant</p>
            </div>
          </div>
          <p style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '8px' }}>This app wants to connect to your AI providers through Byoky.</p>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            <div style={btnGrey}>Deny</div>
            <div style={btnOrange}>Continue</div>
          </div>
        </div>
      )}
      {phase === 'selecting' && (
        <div style={{ ...slideIn as any, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={miniHeader}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            <span style={{ fontSize: '11px', fontWeight: 700, flex: 1 }}>Select providers</span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>Step 1 of 2</span>
          </div>
          <p style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '6px' }}>Choose which providers to allow:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
            {[{ k: 'gemini', l: 'Gemini' }, { k: 'claude', l: 'Claude' }, { k: 'openai', l: 'OpenAI' }].map(({ k, l }) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', borderRadius: '6px', fontSize: '10px', background: checked.has(k) ? 'rgba(255,79,0,0.04)' : 'var(--bg-surface)', border: `1px solid ${checked.has(k) ? 'rgba(255,79,0,0.2)' : 'var(--border)'}`, transition: 'all 0.25s' }}>
                <MiniCheck on={checked.has(k)} />
                <img src={PROVIDER_ICONS[k]} alt="" width={13} height={13} style={{ width: '13px', height: '13px' }} />
                <span style={{ flex: 1 }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '6px', borderRadius: '6px', fontSize: '10px', fontWeight: 600, textAlign: 'center', background: 'var(--teal)', color: '#fff', width: '100%', marginTop: '8px', opacity: checked.size > 0 ? 1 : 0.5, transition: 'opacity 0.3s' }}>Next</div>
        </div>
      )}
      {phase === 'connected' && (
        <div style={{ ...slideIn, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '8px' }}>
          <div style={checkCircle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p style={{ fontSize: '12px', fontWeight: 600 }}>Connected</p>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', width: '100%', textAlign: 'center' }}>
            <p style={{ fontSize: '8px', color: 'var(--text-muted)' }}>agnostic.health can now use</p>
            <p style={{ fontSize: '10px', fontWeight: 500, color: 'var(--text-secondary)', marginTop: '2px' }}>Claude · OpenAI</p>
          </div>
        </div>
      )}
      <style>{animations}</style>
    </div>
  );
}

/* ─── Step 3: AI Just Works ─── */

export function ChatMiniPreview() {
  const STREAM = "I'd recommend spinach, kale, and an iron supplement with vitamin C for better absorption…";
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

  // Main animation sequence — mirrors the original JS engine
  const runAnimation = useCallback(() => {
    // Reset
    setStepsVisible(false);
    setNewMsgVisible(false);
    setShowTyping(false);
    setShowResponse(false);
    setStreamIdx(0);
    setStreaming(false);
    setCursorVisible(true);
    setFooterStreaming(false);
    if (chatRef.current) chatRef.current.scrollTop = 0;

    // Reveal static messages
    requestAnimationFrame(() => setStepsVisible(true));

    const timers: ReturnType<typeof setTimeout>[] = [];
    const d = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

    // 2.5s — slide in new user message
    d(() => { setNewMsgVisible(true); scroll(); }, 2500);

    // 3.5s — show typing
    d(() => { setShowTyping(true); scroll(); }, 3500);

    // 4.5s — hide typing, start streaming
    d(() => {
      setShowTyping(false);
      setShowResponse(true);
      setStreaming(true);
      setFooterStreaming(true);
      setStreamIdx(0);
      scroll();
    }, 4500);

    // 11s — reset for next loop
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

  // Start + loop
  useEffect(() => {
    const cleanup = runAnimation();
    const interval = setInterval(runAnimation, LOOP_MS);
    return () => { cleanup(); clearInterval(interval); };
  }, [runAnimation]);

  // Stream characters
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
        <div style={{ width: '14px', height: '14px', borderRadius: '3px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src="https://agnostic.health/logo.png" alt="" style={{ width: '10px', height: '10px', objectFit: 'contain' }} />
        </div>
        <span style={{ fontSize: '11px', fontWeight: 600, flex: 1 }}>agnostic.health</span>
        <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>via Claude</span>
      </div>

      {/* Chat */}
      <div ref={chatRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px', flex: 1, overflowY: 'auto', scrollbarWidth: 'none', scrollBehavior: 'smooth' }}>
        {/* Static user msg */}
        <div style={{ opacity: stepsVisible ? 1 : 0, transition: 'opacity 0.35s ease 150ms' }}>
          <ChatRow user>Analyze my blood work</ChatRow>
        </div>

        {/* Static AI reply */}
        <div style={{ opacity: stepsVisible ? 1 : 0, transition: 'opacity 0.35s ease 300ms' }}>
          <ChatRow ai>Your iron is at 45 µg/dL — slightly low. B12 and folate look healthy.</ChatRow>
        </div>

        {/* Animated new user msg */}
        <div style={{ opacity: newMsgVisible ? 1 : 0, transform: newMsgVisible ? 'translateY(0)' : 'translateY(8px)', transition: 'all 0.3s ease' }}>
          <ChatRow user>What should I eat to improve?</ChatRow>
        </div>

        {/* Typing indicator */}
        {showTyping && (
          <ChatRow ai>
            <span style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
              <Dot d={0} /><Dot d={150} /><Dot d={300} />
            </span>
          </ChatRow>
        )}

        {/* Streamed response */}
        {showResponse && (
          <ChatRow ai>
            {STREAM.slice(0, streamIdx)}
            {cursorVisible && <span style={{ display: 'inline-block', width: '2px', height: '10px', background: 'var(--teal)', marginLeft: '2px', verticalAlign: 'middle', animation: 'spCursor 1s infinite' }} />}
          </ChatRow>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingTop: '6px', marginTop: '4px', borderTop: '1px solid var(--border)' }}>
        {!footerStreaming ? (
          <>
            <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#16a34a' }} />
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', flex: 1 }}>Connected via Byoky</span>
            <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>Claude 4</span>
          </>
        ) : (
          <>
            <span style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '10px' }}>
              <Dot d={0} s={3} /><Dot d={150} s={3} /><Dot d={300} s={3} />
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', flex: 1 }}>Streaming via Byoky</span>
            <span style={{ fontSize: '8px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{tokens}/8K</span>
          </>
        )}
      </div>

      <style>{animations}</style>
    </div>
  );
}

/* Chat row with avatar */
function ChatRow({ children, user, ai }: { children: React.ReactNode; user?: boolean; ai?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
      <div style={{ width: '16px', height: '16px', borderRadius: '50%', background: ai ? 'rgba(255,79,0,0.08)' : 'var(--bg-surface)', border: `1px solid ${ai ? 'rgba(255,79,0,0.15)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
        {user && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
        {ai && <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg" alt="" style={{ width: '9px', height: '9px', filter: 'brightness(0) invert(0.3)' }} />}
      </div>
      <div style={{ fontSize: '9px', lineHeight: 1.6, padding: '4px 8px', borderRadius: '6px', background: ai ? 'rgba(255,79,0,0.06)' : 'var(--bg-surface)', border: `1px solid ${ai ? 'rgba(255,79,0,0.1)' : 'var(--border)'}`, color: 'var(--text-secondary)', minWidth: 0, flex: ai ? 1 : undefined, textAlign: 'left' }}>
        {children}
      </div>
    </div>
  );
}

/* ─── Shared sub-components ─── */

function WalletIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>;
}

function MiniCheck({ on }: { on: boolean }) {
  return (
    <div style={{ width: '12px', height: '12px', borderRadius: '3px', border: `1.5px solid ${on ? 'var(--teal)' : 'var(--border)'}`, background: on ? 'var(--teal)' : 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s', flexShrink: 0 }}>
      {on && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
  );
}

function MsgBubble({ children, user, ai }: { children: React.ReactNode; user?: boolean; ai?: boolean }) {
  return (
    <div style={{ fontSize: '9px', lineHeight: 1.5, padding: '4px 8px', borderRadius: '6px', maxWidth: '85%', alignSelf: user ? 'flex-end' : 'flex-start', background: ai ? 'rgba(255,79,0,0.06)' : 'var(--bg-surface)', border: `1px solid ${ai ? 'rgba(255,79,0,0.1)' : 'var(--border)'}`, color: 'var(--text-secondary)' }}>
      {children}
    </div>
  );
}

function Dot({ d, s = 4 }: { d: number; s?: number }) {
  return <span style={{ width: `${s}px`, height: `${s}px`, borderRadius: '50%', background: 'var(--teal)', animation: `spBounce 0.8s ease-in-out infinite`, animationDelay: `${d}ms` }} />;
}

/* ─── Styles ─── */

const miniCard: React.CSSProperties = {
  width: '240px', height: '260px', background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: '12px', padding: '14px',
  boxShadow: '0 6px 24px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.03)',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
};

const miniHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '6px',
  paddingBottom: '8px', borderBottom: '1px solid var(--border)',
};

const fadeIn: React.CSSProperties = { animation: 'spFadeIn 0.25s ease' };
const slideIn: React.CSSProperties = { animation: 'spSlideIn 0.3s ease-out' };

const inputFake: React.CSSProperties = {
  padding: '5px 8px', borderRadius: '6px', fontSize: '10px',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  color: 'var(--text-muted)',
};

const btnOrange: React.CSSProperties = {
  flex: 1, padding: '6px', borderRadius: '6px', fontSize: '10px',
  fontWeight: 600, textAlign: 'center', background: 'var(--teal)', color: '#fff',
};

const btnGrey: React.CSSProperties = {
  flex: 1, padding: '6px', borderRadius: '6px', fontSize: '10px',
  fontWeight: 500, textAlign: 'center', background: 'var(--bg-surface)',
  border: '1px solid var(--border)', color: 'var(--text-secondary)',
};

const spinnerSmall: React.CSSProperties = {
  width: '24px', height: '24px', border: '2px solid var(--border)',
  borderTopColor: 'var(--teal)', borderRadius: '50%', animation: 'spSpin 0.6s linear infinite',
};

const checkCircle: React.CSSProperties = {
  width: '28px', height: '28px', borderRadius: '50%',
  background: 'rgba(34,197,94,0.08)', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};

const animations = `
  @keyframes spFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spSlideIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes spSpin { to { transform: rotate(360deg); } }
  @keyframes spBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-3px); } }
  @keyframes spCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
`;
