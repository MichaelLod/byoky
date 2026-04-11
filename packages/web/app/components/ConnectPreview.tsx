'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const STREAM_TEXT = "Added try-catch blocks with exponential backoff retry for each API node. Implements jittered delays starting at 500ms, doubling up to 8s…";

const PROVIDER_ICONS: Record<string, string> = {
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  claude: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
};

type Phase =
  | 'request'
  | 'providers'
  | 'models'
  | 'confirm'
  | 'connecting'
  | 'connected'
  | 'chat-idle'
  | 'chat-newmsg'
  | 'chat-typing'
  | 'chat-streaming'
  | 'chat-done';

const TIMINGS: Record<Phase, number> = {
  'request': 2500,
  'providers': 2200,
  'models': 2000,
  'confirm': 1800,
  'connecting': 1200,
  'connected': 1500,
  'chat-idle': 1500,
  'chat-newmsg': 1000,
  'chat-typing': 1000,
  'chat-streaming': 4000, // controlled by streaming interval
  'chat-done': 3000,
};

export function ConnectPreview() {
  const [phase, setPhase] = useState<Phase>('request');
  const [checkedProviders, setCheckedProviders] = useState<Set<string>>(new Set());
  const [checkedModels, setCheckedModels] = useState<Set<string>>(new Set());
  const [streamIdx, setStreamIdx] = useState(0);
  const chatRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  // Phase machine
  const advance = useCallback(() => {
    setPhase((p) => {
      const order: Phase[] = [
        'request', 'providers', 'models', 'confirm', 'connecting', 'connected',
        'chat-idle', 'chat-newmsg', 'chat-typing', 'chat-streaming', 'chat-done',
      ];
      const idx = order.indexOf(p);
      const next = idx < order.length - 1 ? order[idx + 1] : order[0];

      // Reset on loop
      if (next === 'request') {
        setCheckedProviders(new Set());
        setCheckedModels(new Set());
        setStreamIdx(0);
      }
      // Auto-check providers
      if (next === 'providers') {
        setCheckedProviders(new Set());
        setTimeout(() => setCheckedProviders(new Set(['claude'])), 500);
        setTimeout(() => setCheckedProviders(new Set(['claude', 'openai'])), 900);
      }
      // Auto-check models
      if (next === 'models') {
        setCheckedModels(new Set());
        setTimeout(() => setCheckedModels(new Set(['sonnet'])), 450);
        setTimeout(() => setCheckedModels(new Set(['sonnet', 'gpt4o'])), 800);
      }
      if (next === 'chat-streaming') setStreamIdx(0);
      return next;
    });
  }, []);

  // Auto-advance (except streaming which is self-managed)
  useEffect(() => {
    if (phase === 'chat-streaming') return;
    const t = setTimeout(advance, TIMINGS[phase]);
    return () => clearTimeout(t);
  }, [phase, advance]);

  // Stream characters
  useEffect(() => {
    if (phase !== 'chat-streaming') return;
    if (streamIdx >= STREAM_TEXT.length) { advance(); return; }
    const t = setTimeout(() => {
      setStreamIdx((i) => i + 1);
      if (streamIdx % 5 === 0) scroll();
    }, 30);
    return () => clearTimeout(t);
  }, [phase, streamIdx, advance, scroll]);

  const isChat = phase.startsWith('chat-');
  const isStreaming = phase === 'chat-streaming';
  const isDone = phase === 'chat-done';
  const tokens = ((streamIdx * 3) / 1000).toFixed(1);

  return (
    <div style={card}>
      {/* ─── Connect flow screens ─── */}

      {phase === 'request' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', animation: 'cpFadeIn 0.3s ease' }}>
          <HeaderBar badge="New request" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 8px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '5px', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '9px', fontWeight: 700, color: 'var(--teal)' }}>E</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '11px', fontWeight: 600 }}>excalimate.com</p>
              <p style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Animated whiteboard presentations</p>
            </div>
          </div>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>This app wants to connect to your AI providers through Byoky.</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn label="Deny" secondary /><Btn label="Continue" primary />
          </div>
        </div>
      )}

      {phase === 'providers' && (
        <Screen>
          <StepBar title="Select providers" step={1} />
          <p style={hintText}>Choose which providers excalimate.com can use:</p>
          <div style={listCol}>
            <ProviderRow label="Gemini" icon={PROVIDER_ICONS.gemini} checked={checkedProviders.has('gemini')} />
            <ProviderRow label="Claude" icon={PROVIDER_ICONS.claude} checked={checkedProviders.has('claude')} />
            <ProviderRow label="OpenAI" icon={PROVIDER_ICONS.openai} checked={checkedProviders.has('openai')} />
          </div>
          <Btn label="Next" primary full opacity={checkedProviders.size > 0 ? 1 : 0.5} />
        </Screen>
      )}

      {phase === 'models' && (
        <Screen>
          <StepBar title="Select models" step={2} />
          <p style={hintText}>Choose which models to allow:</p>
          <div style={listCol}>
            <CheckRow label="Claude 4 Sonnet" checked={checkedModels.has('sonnet')} />
            <CheckRow label="GPT-4o" checked={checkedModels.has('gpt4o')} />
          </div>
          <Btn label="Review & connect" primary full opacity={checkedModels.size > 0 ? 1 : 0.5} />
        </Screen>
      )}

      {phase === 'confirm' && (
        <Screen>
          <HeaderBar />
          <div style={summaryCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Favicon size={24} /><span style={{ fontSize: '12px', fontWeight: 500 }}>excalimate.com</span>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <SummaryRow label="Providers" value="Claude, OpenAI" />
              <SummaryRow label="Models" value="Sonnet, GPT-4o" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn label="Cancel" secondary /><Btn label="Confirm" primary />
          </div>
        </Screen>
      )}

      {phase === 'connecting' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', animation: 'cpFadeIn 0.3s ease' }}>
          <div style={{ ...spinner, width: '32px', height: '32px' }} />
          <p style={{ fontSize: '13px', fontWeight: 500, marginTop: '4px' }}>Connecting…</p>
          <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Setting up secure session</p>
        </div>
      )}

      {phase === 'connected' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', animation: 'cpFadeIn 0.3s ease' }}>
          <div style={{ ...successCircle, width: '36px', height: '36px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p style={{ fontSize: '13px', fontWeight: 700 }}>Connected</p>
          <div style={{ ...summaryCard, width: '100%', textAlign: 'center', padding: '8px 12px' }}>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>excalimate.com can now use</p>
            <p style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', marginTop: '2px' }}>Claude 4 Sonnet · GPT-4o</p>
          </div>
        </div>
      )}

      {/* ─── Chat screens ─── */}

      {isChat && (
        <div style={{ display: 'flex', flexDirection: 'column', animation: phase === 'chat-idle' ? 'cpFadeIn 0.3s ease' : undefined }}>
          {/* Chat header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '10px', marginBottom: '4px', borderBottom: '1px solid var(--border)' }}>
            <Favicon size={20} />
            <span style={{ fontSize: '12px', fontWeight: 600, flex: 1 }}>excalimate.com</span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>via Claude</span>
          </div>

          {/* Messages */}
          <div ref={chatRef} style={{
            display: 'flex', flexDirection: 'column', gap: '10px',
            minHeight: '140px', maxHeight: '140px', overflowY: 'auto',
            scrollBehavior: 'smooth', scrollbarWidth: 'none',
          }}>
            <MsgRow user>Create a flowchart for user authentication.</MsgRow>
            <MsgRow ai>Here&apos;s an auth flowchart with login, OAuth, and session nodes…</MsgRow>

            {/* New user message */}
            <div style={{
              ...msgRowStyle, opacity: phase === 'chat-idle' ? 0 : 1,
              transform: phase === 'chat-idle' ? 'translateY(8px)' : 'translateY(0)',
              transition: 'all 0.3s ease',
            }}>
              <UserAvatar /><div style={userBubble}>Now add error handling and retry logic.</div>
            </div>

            {/* Typing */}
            {phase === 'chat-typing' && (
              <div style={msgRowStyle}>
                <AiAvatar />
                <div style={{ ...aiBubble, display: 'flex', alignItems: 'center', gap: '3px', padding: '6px 10px' }}>
                  <Dot d={0} /><Dot d={150} /><Dot d={300} />
                </div>
              </div>
            )}

            {/* Stream */}
            {(isStreaming || isDone) && (
              <div style={msgRowStyle}>
                <AiAvatar />
                <div style={{ ...aiBubble, minWidth: 0 }}>
                  <span>{STREAM_TEXT.slice(0, streamIdx)}</span>
                  {isStreaming && <span style={cursorStyle} />}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', marginTop: '6px', borderTop: '1px solid var(--border)' }}>
            {!isStreaming ? (
              <>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                <span style={footerText}>Connected via Byoky</span>
                <span style={{ ...footerText, fontFamily: 'monospace', flex: 'none' }}>Claude 4</span>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '12px' }}>
                  <Dot d={0} s={3} /><Dot d={150} s={3} /><Dot d={300} s={3} />
                </div>
                <span style={{ ...footerText, flex: 1 }}>Streaming via Byoky</span>
                <span style={{ ...footerText, fontFamily: 'monospace', flex: 'none' }}>{tokens}/8K</span>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes cpFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes cpSpin { to { transform: rotate(360deg); } }
        @keyframes cpBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-4px); } }
        @keyframes cpCursor { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

/* ─── Sub-components ─── */

function Screen({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', animation: 'cpFadeIn 0.3s ease', ...(center ? { alignItems: 'center', justifyContent: 'center', padding: '16px 0' } : {}) }}>{children}</div>;
}

function HeaderBar({ badge }: { badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
      <span style={{ fontSize: '12px', fontWeight: 700, flex: 1 }}>Byoky</span>
      {badge && <span style={{ fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: 'rgba(255,79,0,0.1)', color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{badge}</span>}
    </div>
  );
}

function StepBar({ title, step }: { title: string; step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '10px', borderBottom: '1px solid var(--border)' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      <span style={{ fontSize: '12px', fontWeight: 700, flex: 1 }}>{title}</span>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Step {step} of 2</span>
    </div>
  );
}

function Favicon({ size = 28 }: { size?: number }) {
  return <div style={{ width: `${size}px`, height: `${size}px`, borderRadius: size > 22 ? '8px' : '4px', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}><span style={{ fontSize: `${Math.round(size * 0.35)}px`, fontWeight: 700, color: 'var(--teal)' }}>E</span></div>;
}

function AppRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px' }}>
      <Favicon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>excalimate.com</p>
        <p style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Animated whiteboard presentations</p>
      </div>
    </div>
  );
}

function ProviderRow({ label, icon, checked }: { label: string; icon: string; checked: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', background: checked ? 'rgba(255,79,0,0.04)' : 'var(--bg-surface)', border: `1px solid ${checked ? 'rgba(255,79,0,0.2)' : 'var(--border)'}`, color: 'var(--text-secondary)', transition: 'all 0.25s ease' }}>
      <Chk checked={checked} />
      <img src={icon} alt="" width={14} height={14} style={{ width: '14px', height: '14px' }} />
      <span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

function CheckRow({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '8px', fontSize: '12px', background: checked ? 'rgba(255,79,0,0.04)' : 'var(--bg-surface)', border: `1px solid ${checked ? 'rgba(255,79,0,0.2)' : 'var(--border)'}`, color: 'var(--text-secondary)', transition: 'all 0.25s ease' }}>
      <Chk checked={checked} /><span style={{ flex: 1 }}>{label}</span>
    </div>
  );
}

function Chk({ checked }: { checked: boolean }) {
  return (
    <div style={{ width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, border: `1.5px solid ${checked ? 'var(--teal)' : 'var(--border)'}`, background: checked ? 'var(--teal)' : 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.25s ease' }}>
      {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
  );
}

function Btn({ label, primary, secondary, full, opacity = 1 }: { label: string; primary?: boolean; secondary?: boolean; full?: boolean; opacity?: number }) {
  return <div style={{ flex: full ? undefined : 1, width: full ? '100%' : undefined, padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500, textAlign: 'center', background: primary ? 'var(--teal)' : 'var(--bg-surface)', color: primary ? '#fff' : 'var(--text-secondary)', border: secondary ? '1px solid var(--border)' : 'none', opacity, transition: 'opacity 0.3s ease', marginTop: full ? '4px' : undefined }}>{label}</div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}><span style={{ color: 'var(--text-muted)' }}>{label}</span><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{value}</span></div>;
}

function MsgRow({ children, user, ai }: { children: React.ReactNode; user?: boolean; ai?: boolean }) {
  return (
    <div style={msgRowStyle}>
      {user && <UserAvatar />}{ai && <AiAvatar />}
      <div style={user ? userBubble : aiBubble}>{children}</div>
    </div>
  );
}

function UserAvatar() {
  return <div style={avatarStyle}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></div>;
}

function AiAvatar() {
  return <div style={{ ...avatarStyle, background: 'rgba(255,79,0,0.08)' }}><img src={PROVIDER_ICONS.claude} alt="" width={11} height={11} style={{ width: '11px', height: '11px', filter: 'brightness(0) invert(0.3)' }} /></div>;
}

function Dot({ d, s = 4 }: { d: number; s?: number }) {
  return <span style={{ width: `${s}px`, height: `${s}px`, borderRadius: '50%', background: 'var(--teal)', animation: `cpBounce 0.8s ease-in-out infinite`, animationDelay: `${d}ms` }} />;
}

/* ─── Styles ─── */

const card: React.CSSProperties = { width: '280px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)', overflow: 'hidden' };
const bodyText: React.CSSProperties = { fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 };
const hintText: React.CSSProperties = { fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.5 };
const listCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' };
const summaryCard: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px' };
const msgRowStyle: React.CSSProperties = { display: 'flex', gap: '8px', alignItems: 'flex-start' };
const avatarStyle: React.CSSProperties = { width: '20px', height: '20px', borderRadius: '50%', background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' };
const userBubble: React.CSSProperties = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 };
const aiBubble: React.CSSProperties = { background: 'rgba(255,79,0,0.06)', border: '1px solid rgba(255,79,0,0.1)', borderRadius: '8px', padding: '6px 10px', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.6 };
const spinner: React.CSSProperties = { width: '40px', height: '40px', border: '2px solid var(--border)', borderTopColor: 'var(--teal)', borderRadius: '50%', animation: 'cpSpin 0.6s linear infinite' };
const successCircle: React.CSSProperties = { width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(34,197,94,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const cursorStyle: React.CSSProperties = { display: 'inline-block', width: '2px', height: '12px', background: 'var(--teal)', marginLeft: '2px', verticalAlign: 'middle', animation: 'cpCursor 1s infinite' };
const footerText: React.CSSProperties = { fontSize: '9px', color: 'var(--text-muted)', flex: 1 };
