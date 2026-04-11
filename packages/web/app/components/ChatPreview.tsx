'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const STREAM_TEXT = "Added try-catch blocks with exponential backoff retry for each node…";

export function ChatPreview() {
  const [phase, setPhase] = useState<'idle' | 'newmsg' | 'typing' | 'streaming' | 'done'>('idle');
  const [streamIdx, setStreamIdx] = useState(0);
  const [stepsVisible, setStepsVisible] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  // Main animation loop
  useEffect(() => {
    setStepsVisible(false);
    requestAnimationFrame(() => setStepsVisible(true));

    const t1 = setTimeout(() => { setPhase('newmsg'); scroll(); }, 2500);
    const t2 = setTimeout(() => { setPhase('typing'); scroll(); }, 3500);
    const t3 = setTimeout(() => { setPhase('streaming'); setStreamIdx(0); scroll(); }, 4500);
    const t4 = setTimeout(() => {
      setPhase('idle'); setStreamIdx(0); setStepsVisible(false);
      if (chatRef.current) chatRef.current.scrollTop = 0;
    }, 11000);

    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [scroll]);

  // Restart loop
  useEffect(() => {
    if (phase === 'idle' && !stepsVisible) {
      const t = setTimeout(() => {
        setStepsVisible(true);
        setPhase('idle');
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [phase, stepsVisible]);

  // Stream characters
  useEffect(() => {
    if (phase !== 'streaming') return;
    if (streamIdx >= STREAM_TEXT.length) { setPhase('done'); return; }
    const t = setTimeout(() => {
      setStreamIdx((i) => i + 1);
      if (streamIdx % 5 === 0) scroll();
    }, 35);
    return () => clearTimeout(t);
  }, [phase, streamIdx, scroll]);

  // Auto-restart after done
  useEffect(() => {
    if (phase === 'done') {
      const t = setTimeout(() => {
        setPhase('idle');
        setStreamIdx(0);
        setStepsVisible(false);
        if (chatRef.current) chatRef.current.scrollTop = 0;
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const isStreaming = phase === 'streaming' || phase === 'done';
  const tokens = ((streamIdx * 3) / 1000).toFixed(1);

  return (
    <div style={card}>
      {/* Header */}
      <div style={{
        ...stepStyle(stepsVisible, 0),
        display: 'flex', alignItems: 'center', gap: '8px',
        paddingBottom: '10px', marginBottom: '4px',
        borderBottom: '1px solid var(--ap-border, var(--border))',
      }}>
        <div style={faviconSmall}>
          <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--teal)' }}>E</span>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ap-text-primary, var(--text))', flex: 1 }}>
          excalimate.com
        </span>
        <span style={{ fontSize: '9px', color: 'var(--ap-text-tertiary, var(--text-muted))' }}>via Claude</span>
      </div>

      {/* Chat area */}
      <div style={{ position: 'relative' }}>
        <div ref={chatRef} style={{
          display: 'flex', flexDirection: 'column', gap: '10px',
          minHeight: '140px', maxHeight: '140px', overflowY: 'auto',
          scrollBehavior: 'smooth', scrollbarWidth: 'none',
        }}>
          {/* User message 1 */}
          <div style={{ ...stepStyle(stepsVisible, 1), ...msgRow }}>
            <UserAvatar />
            <div style={userBubble}>Create a flowchart for user authentication.</div>
          </div>

          {/* AI response 1 */}
          <div style={{ ...stepStyle(stepsVisible, 2), ...msgRow }}>
            <AiAvatar />
            <div style={aiBubble}>Here&apos;s an auth flowchart with login, OAuth, and session nodes…</div>
          </div>

          {/* User message 2 (animated) */}
          <div style={{
            ...msgRow,
            opacity: phase === 'idle' ? 0 : 1,
            transform: phase === 'idle' ? 'translateY(8px)' : 'translateY(0)',
            transition: 'all 0.3s ease',
          }}>
            <UserAvatar />
            <div style={userBubble}>Now add error handling and retry logic.</div>
          </div>

          {/* Typing indicator */}
          {phase === 'typing' && (
            <div style={{ ...msgRow }}>
              <AiAvatar />
              <div style={{ ...aiBubble, display: 'flex', alignItems: 'center', gap: '3px', padding: '6px 10px' }}>
                <BounceDot delay={0} />
                <BounceDot delay={150} />
                <BounceDot delay={300} />
              </div>
            </div>
          )}

          {/* Streamed response */}
          {isStreaming && (
            <div style={msgRow}>
              <AiAvatar />
              <div style={{ ...aiBubble, minWidth: 0 }}>
                <span>{STREAM_TEXT.slice(0, streamIdx)}</span>
                {phase === 'streaming' && (
                  <span style={{
                    display: 'inline-block', width: '2px', height: '12px',
                    background: 'var(--teal)', marginLeft: '2px',
                    verticalAlign: 'middle', animation: 'cpCursorPulse 1s infinite',
                  }} />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        paddingTop: '8px', marginTop: '6px',
        borderTop: '1px solid var(--ap-border, var(--border))',
      }}>
        {!isStreaming ? (
          <>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
            <span style={footerText}>Connected via Byoky</span>
            <span style={{ ...footerText, fontFamily: 'monospace' }}>Claude 4</span>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '12px' }}>
              <BounceDot delay={0} size={3} />
              <BounceDot delay={150} size={3} />
              <BounceDot delay={300} size={3} />
            </div>
            <span style={{ ...footerText, flex: 1 }}>Streaming via Byoky</span>
            <span style={{ ...footerText, fontFamily: 'monospace' }}>{tokens}/8K context</span>
          </>
        )}
      </div>

      <style>{`
        @keyframes cpBounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-4px); } }
        @keyframes cpCursorPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </div>
  );
}

/* --- Sub-components --- */

function UserAvatar() {
  return (
    <div style={avatarBase}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ap-text-tertiary, var(--text-muted))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );
}

function AiAvatar() {
  return (
    <div style={{ ...avatarBase, background: 'rgba(255,79,0,0.08)' }}>
      <img
        src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg"
        alt="" width={11} height={11}
        style={{ width: '11px', height: '11px', filter: 'brightness(0) invert(0.3)' }}
      />
    </div>
  );
}

function BounceDot({ delay, size = 4 }: { delay: number; size?: number }) {
  return (
    <span style={{
      width: `${size}px`, height: `${size}px`, borderRadius: '50%',
      background: 'var(--teal)',
      animation: `cpBounce 0.8s ease-in-out infinite`,
      animationDelay: `${delay}ms`,
    }} />
  );
}

/* --- Styles --- */

function stepStyle(visible: boolean, idx: number): React.CSSProperties {
  return {
    opacity: visible ? 1 : 0,
    transition: `opacity 0.35s ease ${idx * 150}ms`,
  };
}

const card: React.CSSProperties = {
  width: '300px',
  background: 'var(--bg-card, #fafaf9)',
  border: '1px solid var(--border, #e7e5e4)',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const msgRow: React.CSSProperties = {
  display: 'flex', gap: '8px', alignItems: 'flex-start',
};

const avatarBase: React.CSSProperties = {
  width: '20px', height: '20px', borderRadius: '50%',
  background: 'var(--bg-surface, #f5f5f4)',
  border: '1px solid var(--border, #e7e5e4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0, marginTop: '2px',
};

const userBubble: React.CSSProperties = {
  background: 'var(--bg-surface, #f5f5f4)',
  border: '1px solid var(--border, #e7e5e4)',
  borderRadius: '8px', padding: '6px 10px',
  fontSize: '11px', color: 'var(--text-secondary, #44403c)', lineHeight: 1.6,
};

const aiBubble: React.CSSProperties = {
  background: 'rgba(255,79,0,0.06)',
  border: '1px solid rgba(255,79,0,0.1)',
  borderRadius: '8px', padding: '6px 10px',
  fontSize: '11px', color: 'var(--text-secondary, #44403c)', lineHeight: 1.6,
};

const faviconSmall: React.CSSProperties = {
  width: '20px', height: '20px', borderRadius: '4px',
  background: 'var(--bg-surface, #f5f5f4)',
  border: '1px solid var(--border, #e7e5e4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  overflow: 'hidden', flexShrink: 0,
};

const footerText: React.CSSProperties = {
  fontSize: '9px', color: 'var(--text-muted, #a8a29e)', flex: 1,
};
