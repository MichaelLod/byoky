'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FadeIn } from './FadeIn';

type Speaker = 'marco' | 'leo';

type Message = {
  text?: ReactNode;
  link?: boolean;
  time: string;
};

type Run = {
  speaker: Speaker;
  msgs: Message[];
};

const CONVERSATION: Run[] = [
  {
    speaker: 'marco',
    msgs: [
      { text: <>yo bro, quick q 👀</>, time: '14:32' },
      { text: <>how many tokens u got left on your anthropic sub this week?</>, time: '14:32' },
    ],
  },
  {
    speaker: 'leo',
    msgs: [
      { text: <>man i only used like <strong>6%</strong> this week 😎</>, time: '14:33' },
      { text: <>what about you?</>, time: '14:33' },
    ],
  },
  {
    speaker: 'marco',
    msgs: [
      { text: <>dude... i already hit <strong>99%</strong> 💀</>, time: '14:34' },
      { text: <>stuck for the rest of the week fr</>, time: '14:34' },
    ],
  },
  {
    speaker: 'leo',
    msgs: [
      { text: <>no problem, use mine via byoky 🤝</>, time: '14:34' },
      { text: <>i got you covered</>, time: '14:34' },
      { link: true, time: '14:35' },
    ],
  },
];

const CONTACTS: Record<Speaker, { name: string; initial: string; avatar: string }> = {
  marco: { name: 'Marco', initial: 'M', avatar: 'linear-gradient(135deg, #ff8a3d, #FF4F00)' },
  leo: { name: 'Leo', initial: 'L', avatar: 'linear-gradient(135deg, #4ecbd9, #0891b2)' },
};

type FlatMsg = Message & {
  speaker: Speaker;
  isFirstInRun: boolean;
  showTypingBefore: boolean;
};

const FLAT: FlatMsg[] = (() => {
  const out: FlatMsg[] = [];
  CONVERSATION.forEach((run, runIdx) => {
    run.msgs.forEach((msg, msgIdx) => {
      const isFirstInRun = msgIdx === 0;
      out.push({
        ...msg,
        speaker: run.speaker,
        isFirstInRun,
        showTypingBefore: isFirstInRun && runIdx > 0,
      });
    });
  });
  return out;
})();

const MESSAGE_DELAY = 1000;
const TYPING_DELAY = 700;

export function WhatsAppChat() {
  return (
    <section className="wa-section">
      <div className="wa-bg-glow" aria-hidden />
      <div className="container">
        <FadeIn>
          <div className="wa-head">
            <div className="wa-eyebrow">
              <span className="wa-eyebrow-dot" />
              A familiar story
            </div>
            <h2>
              &ldquo;Bro, I&apos;m <span className="wa-gradient">out of tokens.</span>&rdquo;
            </h2>
            <p className="wa-subtitle">
              It&apos;s Thursday. Your Anthropic limit resets on Monday.
              Your buddy hasn&apos;t touched his. Byoky lets him share — no keys, no accounts, no friction.
            </p>
          </div>
        </FadeIn>

        <div className="wa-layout">
          <FadeIn delay={0.15}>
            <Phone pov="leo" />
          </FadeIn>

          <div className="wa-copy">
            <FadeIn delay={0.25}>
              <div className="wa-feature">
                <div className="wa-feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 12v10H4V12" />
                    <path d="M2 7h20v5H2z" />
                    <path d="M12 22V7" />
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                  </svg>
                </div>
                <div>
                  <h3>Send a token gift in one tap</h3>
                  <p>
                    Pick a provider, set a budget cap, share the link. They redeem it
                    in their wallet — your API key never leaves yours.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.35}>
              <div className="wa-feature">
                <div className="wa-feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 11l18-8-8 18-2-8-8-2z" />
                  </svg>
                </div>
                <div>
                  <h3>Requests relay through you</h3>
                  <p>
                    Their prompts hit your wallet, which forwards them to Anthropic using
                    your key. They get tokens. You keep control.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.45}>
              <div className="wa-feature">
                <div className="wa-feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M4.93 4.93l14.14 14.14" />
                  </svg>
                </div>
                <div>
                  <h3>Revoke any time</h3>
                  <p>
                    One click kills the gift. Budget caps enforce limits automatically
                    so nobody burns through your quota by accident.
                  </p>
                </div>
              </div>
            </FadeIn>
            <FadeIn delay={0.55}>
              <div className="wa-cta-row">
                <a href="/token-pool" className="btn btn-primary">
                  Browse free gifts
                </a>
                <a href="/docs#gifts" className="btn btn-secondary">
                  How gifting works
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </div>

      <style>{`
        .wa-section {
          padding: var(--section-padding) 0;
          position: relative;
          overflow: hidden;
        }
        .wa-bg-glow {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 15% 30%, rgba(37, 211, 102, 0.10), transparent 60%),
            radial-gradient(ellipse 60% 50% at 85% 70%, rgba(255, 79, 0, 0.07), transparent 60%);
          pointer-events: none;
          z-index: 0;
        }
        .wa-section .container { position: relative; z-index: 1; }

        .wa-head {
          text-align: center;
          max-width: 680px;
          margin: 0 auto 56px;
        }
        .wa-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 999px;
          background: rgba(37, 211, 102, 0.08);
          border: 1px solid rgba(37, 211, 102, 0.22);
          color: #128c4a;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 18px;
        }
        .wa-eyebrow-dot {
          width: 7px; height: 7px;
          border-radius: 999px;
          background: #25d366;
          box-shadow: 0 0 10px rgba(37, 211, 102, 0.55);
        }
        .wa-head h2 {
          font-size: 48px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin-bottom: 18px;
        }
        .wa-gradient {
          background: linear-gradient(90deg, #FF4F00, #ff8a3d);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .wa-subtitle {
          font-size: 17px;
          line-height: 1.6;
          color: var(--text-secondary);
        }

        /* ─── Two-column layout ──────────────────── */
        .wa-layout {
          display: grid;
          grid-template-columns: minmax(300px, 360px) 1fr;
          gap: 72px;
          align-items: center;
        }

        .wa-copy {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .wa-feature {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }
        .wa-feature-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(37, 211, 102, 0.1);
          color: #128c4a;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          border: 1px solid rgba(37, 211, 102, 0.22);
        }
        .wa-feature-icon svg { width: 22px; height: 22px; }
        .wa-feature h3 {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
          margin-bottom: 4px;
          color: var(--text);
        }
        .wa-feature p {
          font-size: 15px;
          line-height: 1.55;
          color: var(--text-secondary);
          margin: 0;
        }
        .wa-cta-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        @media (max-width: 820px) {
          .wa-layout {
            grid-template-columns: 1fr;
            gap: 48px;
          }
          .wa-head h2 { font-size: 34px; }
        }
        @media (max-width: 480px) {
          .wa-head h2 { font-size: 28px; }
          .wa-subtitle { font-size: 15px; }
        }
      `}</style>
    </section>
  );
}

/* ─── Phone ─────────────────────────────────────── */

function Phone({ pov }: { pov: Speaker }) {
  const contact = pov === 'leo' ? CONTACTS.marco : CONTACTS.leo;

  const [visible, setVisible] = useState(0);
  const [typingFor, setTypingFor] = useState<Speaker | null>(null);
  const [started, setStarted] = useState(false);
  const phoneRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  // Kick off playback when phone scrolls into view
  useEffect(() => {
    if (started) return;
    const node = phoneRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  // Drive the reveal sequence
  useEffect(() => {
    if (!started) return;
    if (visible >= FLAT.length) return;

    const next = FLAT[visible];
    let timers: ReturnType<typeof setTimeout>[] = [];

    // Only show typing for the other party, not ourselves
    const showTyping = next.showTypingBefore && next.speaker !== pov;

    if (showTyping) {
      timers.push(
        setTimeout(() => setTypingFor(next.speaker), 300),
        setTimeout(() => {
          setTypingFor(null);
          setVisible((v) => v + 1);
        }, TYPING_DELAY + 300)
      );
    } else {
      timers.push(
        setTimeout(() => setVisible((v) => v + 1), visible === 0 ? 400 : MESSAGE_DELAY)
      );
    }

    return () => timers.forEach(clearTimeout);
  }, [visible, started]);

  // Auto-scroll the messages pane
  useEffect(() => {
    if (!messagesRef.current) return;
    messagesRef.current.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [visible, typingFor]);

  const flatUpTo = useMemo(() => FLAT.slice(0, visible), [visible]);
  // Re-group the visible slice back into runs so tails render correctly
  const visibleRuns = useMemo(() => {
    const runs: { speaker: Speaker; msgs: FlatMsg[] }[] = [];
    flatUpTo.forEach((m) => {
      const last = runs[runs.length - 1];
      if (last && last.speaker === m.speaker) last.msgs.push(m);
      else runs.push({ speaker: m.speaker, msgs: [m] });
    });
    return runs;
  }, [flatUpTo]);

  return (
    <div className="wa-phone" ref={phoneRef}>
      <div className="wa-phone-notch" aria-hidden />
      <div className="wa-phone-screen">
        <div className="wa-header">
          <svg className="wa-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <div className="wa-avatar" style={{ background: contact.avatar }}>
            <span>{contact.initial}</span>
          </div>
          <div className="wa-meta">
            <div className="wa-name">{contact.name}</div>
            <div className="wa-status">{typingFor === contact.name.toLowerCase() ? 'typing…' : 'online'}</div>
          </div>
          <div className="wa-actions">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M15 10.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3.5l5 3.5V7l-5 3.5z" />
            </svg>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
            </svg>
          </div>
        </div>

        <div className="wa-chat">
          <div className="wa-wallpaper" aria-hidden />
          <div className="wa-messages" ref={messagesRef}>
            <div className="wa-day">
              <span>TODAY</span>
            </div>
            {visibleRuns.map((run, runIdx) => {
              const side = run.speaker === pov ? 'out' : 'in';
              return (
                <div key={runIdx} className={`wa-run wa-run-${side}`}>
                  {run.msgs.map((msg, i) => {
                    const tail = msg.isFirstInRun;
                    if (msg.link) {
                      return (
                        <div key={i} className={`wa-bubble wa-bubble-${side} wa-bubble-link wa-enter${tail ? ` wa-tail-${side}` : ''}`}>
                          <ByokyLinkPreview />
                          <div className="wa-link-caption">
                            install it, ping me, i&apos;ll send a gift 🎁
                            <span className="wa-time">
                              {msg.time}
                              {side === 'out' && <DoubleCheck />}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={i} className={`wa-bubble wa-bubble-${side} wa-enter${tail ? ` wa-tail-${side}` : ''}`}>
                        {msg.text}
                        <span className="wa-time">
                          {msg.time}
                          {side === 'out' && <DoubleCheck />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {typingFor && (
              <div className={`wa-run wa-run-${typingFor === pov ? 'out' : 'in'}`}>
                <div className={`wa-typing wa-typing-${typingFor === pov ? 'out' : 'in'}`} aria-label="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="wa-composer">
          <div className="wa-composer-input">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
              <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
            </svg>
            <span>Message</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M14.5 9V5.5a2.5 2.5 0 0 0-5 0V12a4 4 0 0 0 8 0V7" />
            </svg>
          </div>
          <div className="wa-mic">
            <svg viewBox="0 0 24 24" fill="#fff" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
              <path d="M17 11a5 5 0 0 1-10 0" stroke="#fff" strokeWidth="1.8" fill="none" />
              <path d="M12 16v3M9 19h6" stroke="#fff" strokeWidth="1.8" fill="none" />
            </svg>
          </div>
        </div>
      </div>

      <style>{`
        .wa-phone {
          position: relative;
          width: 100%;
          max-width: 340px;
          /* Cap height to viewport so the bottom bezel never falls below the
             fold on small screens. svh accounts for mobile browser chrome
             (URL bar) better than vh — width adjusts via aspect-ratio. */
          max-height: 80svh;
          margin: 0 auto;
          aspect-ratio: 340 / 700;
          border-radius: 42px;
          background: linear-gradient(145deg, #1f1f1f, #0a0a0a);
          padding: 10px;
          box-shadow:
            0 40px 80px -20px rgba(20, 83, 45, 0.28),
            0 20px 40px -10px rgba(0, 0, 0, 0.25),
            inset 0 0 0 1.5px rgba(255, 255, 255, 0.08);
        }
        .wa-phone-notch {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          width: 88px;
          height: 26px;
          border-radius: 16px;
          background: #000;
          z-index: 3;
        }
        .wa-phone-screen {
          position: relative;
          height: 100%;
          border-radius: 32px;
          overflow: hidden;
          background: #efeae2;
          display: flex;
          flex-direction: column;
          isolation: isolate;
        }

        .wa-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 40px 12px 8px;
          background: #008069;
          color: #fff;
          flex-shrink: 0;
        }
        .wa-back { width: 18px; height: 18px; flex-shrink: 0; opacity: 0.95; }
        .wa-avatar {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-size: 14px;
          font-weight: 700;
          flex-shrink: 0;
          color: #fff;
        }
        .wa-meta { flex: 1; min-width: 0; line-height: 1.15; }
        .wa-name { font-size: 14.5px; font-weight: 600; letter-spacing: -0.01em; }
        .wa-status { font-size: 11.5px; opacity: 0.85; margin-top: 1px; }
        .wa-actions { display: inline-flex; gap: 12px; color: #fff; opacity: 0.92; }
        .wa-actions svg { width: 18px; height: 18px; }

        .wa-chat { flex: 1; position: relative; overflow: hidden; }
        .wa-wallpaper {
          position: absolute;
          inset: 0;
          background-color: #efeae2;
          background-image:
            radial-gradient(circle at 20% 30%, rgba(17, 27, 33, 0.05) 1px, transparent 1px),
            radial-gradient(circle at 70% 60%, rgba(17, 27, 33, 0.04) 1px, transparent 1px),
            radial-gradient(circle at 40% 80%, rgba(17, 27, 33, 0.05) 1px, transparent 1px),
            radial-gradient(circle at 90% 20%, rgba(17, 27, 33, 0.04) 1px, transparent 1px);
          background-size: 120px 120px, 90px 90px, 140px 140px, 110px 110px;
          z-index: 0;
        }
        .wa-messages {
          position: relative;
          z-index: 1;
          height: 100%;
          overflow-y: auto;
          padding: 6px 8px 10px;
          scrollbar-width: none;
          scroll-behavior: smooth;
        }
        .wa-messages::-webkit-scrollbar { display: none; }

        .wa-day { text-align: center; margin: 6px 0 12px; }
        .wa-day span {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 8px;
          background: rgba(225, 245, 254, 0.92);
          color: #54656f;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.06em;
        }

        .wa-run {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 12px;
        }
        .wa-run-in { align-items: flex-start; }
        .wa-run-out { align-items: flex-end; }

        .wa-bubble {
          position: relative;
          max-width: 78%;
          padding: 6px 9px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.38;
          color: #111b21;
          word-wrap: break-word;
          box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
        }
        .wa-bubble strong { font-weight: 700; }
        .wa-bubble-in { background: #fff; }
        .wa-bubble-out { background: #d9fdd3; }

        .wa-enter {
          animation: wa-pop 0.28s cubic-bezier(0.18, 0.85, 0.32, 1.18) both;
          transform-origin: top;
        }
        .wa-run-in .wa-enter { transform-origin: top left; }
        .wa-run-out .wa-enter { transform-origin: top right; }
        @keyframes wa-pop {
          0% { opacity: 0; transform: translateY(6px) scale(0.9); }
          70% { opacity: 1; transform: translateY(0) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        .wa-tail-in { border-top-left-radius: 0; }
        .wa-tail-in::before {
          content: '';
          position: absolute;
          left: -6px;
          top: 0;
          width: 8px;
          height: 13px;
          background: #fff;
          clip-path: polygon(100% 0, 100% 100%, 0 0);
        }
        .wa-tail-out { border-top-right-radius: 0; }
        .wa-tail-out::before {
          content: '';
          position: absolute;
          right: -6px;
          top: 0;
          width: 8px;
          height: 13px;
          background: #d9fdd3;
          clip-path: polygon(0 0, 100% 0, 0 100%);
        }

        .wa-time {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          float: right;
          font-size: 10.5px;
          color: #667781;
          margin-left: 8px;
          margin-top: 3px;
          line-height: 1;
          position: relative;
          top: 4px;
          white-space: nowrap;
        }
        .wa-time svg { width: 14px; height: 14px; }

        .wa-bubble-link {
          max-width: 86%;
          padding: 3px;
          overflow: hidden;
        }
        .wa-link-caption {
          padding: 3px 7px 4px;
          font-size: 13px;
          color: #111b21;
          line-height: 1.38;
        }

        /* ─── Typing indicator ────────────────────── */
        .wa-typing {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 10px 12px;
          border-radius: 8px;
          box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
          animation: wa-pop 0.22s ease-out both;
        }
        .wa-typing-in {
          background: #fff;
          border-top-left-radius: 0;
        }
        .wa-typing-out {
          background: #d9fdd3;
          border-top-right-radius: 0;
        }
        .wa-typing span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #8696a0;
          display: inline-block;
          animation: wa-dots 1.3s infinite ease-in-out both;
        }
        .wa-typing span:nth-child(1) { animation-delay: -0.32s; }
        .wa-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes wa-dots {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }

        .wa-composer {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px 16px;
          background: #f0f2f5;
          flex-shrink: 0;
        }
        .wa-composer-input {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 12px;
          background: #fff;
          border-radius: 999px;
          color: #54656f;
          font-size: 12.5px;
        }
        .wa-composer-input svg { width: 17px; height: 17px; flex-shrink: 0; }
        .wa-composer-input span { flex: 1; }
        .wa-mic {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          background: #008069;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .wa-mic svg { width: 18px; height: 18px; }
      `}</style>
    </div>
  );
}

/* ─── byoky.com link preview ────────────────────── */

function ByokyLinkPreview() {
  return (
    <a
      href="https://byoky.com"
      target="_blank"
      rel="noopener noreferrer"
      className="wa-link"
    >
      <div className="wa-link-hero">
        <div className="wa-link-glow" aria-hidden />
        <div className="wa-link-chrome">
          <span />
          <span />
          <span />
          <div className="wa-link-url-bar">byoky.com</div>
        </div>
        <div className="wa-link-content">
          <div className="wa-link-badge-pill">
            <span className="wa-link-badge-dot" />
            The AI token network
          </div>
          <div className="wa-link-headline">
            <div className="wa-link-h-fade">One network.</div>
            <div className="wa-link-h-grad">All your AI tokens.</div>
          </div>
          <div className="wa-link-buttons">
            <span className="wa-link-btn wa-link-btn-primary">Start Building</span>
            <span className="wa-link-btn wa-link-btn-sec">↓ Install Wallet</span>
          </div>
        </div>
      </div>
      <div className="wa-link-meta">
        <div className="wa-link-title">Byoky — The AI token network</div>
        <div className="wa-link-desc">
          Share your AI tokens with friends, your team, or anyone building cool stuff —
          without exposing your keys.
        </div>
        <div className="wa-link-domain">
          <span className="wa-link-favicon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 2 4 7v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V7l-8-5Z" fill="#FF4F00" />
              <path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </span>
          byoky.com
        </div>
      </div>

      <style>{`
        .wa-link {
          display: block;
          border-radius: 6px;
          overflow: hidden;
          background: #fff;
          text-decoration: none;
          color: inherit;
        }
        .wa-link-hero {
          position: relative;
          aspect-ratio: 16 / 10;
          background: #fafaf9;
          border-bottom: 1px solid #e7e5e4;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .wa-link-glow {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 60% 50% at 20% 20%, rgba(255, 79, 0, 0.18), transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 80%, rgba(255, 138, 61, 0.15), transparent 60%);
          pointer-events: none;
        }
        .wa-link-chrome {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 5px 7px;
          background: #fff;
          border-bottom: 1px solid #e7e5e4;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }
        .wa-link-chrome > span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
        }
        .wa-link-chrome > span:nth-child(1) { background: #ff5f57; }
        .wa-link-chrome > span:nth-child(2) { background: #febc2e; }
        .wa-link-chrome > span:nth-child(3) { background: #28c840; }
        .wa-link-url-bar {
          flex: 1;
          margin-left: 8px;
          padding: 2px 8px;
          border-radius: 4px;
          background: #f5f5f4;
          font-size: 8.5px;
          color: #57534e;
          text-align: center;
          letter-spacing: 0.01em;
        }
        .wa-link-content {
          position: relative;
          z-index: 1;
          flex: 1;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          justify-content: center;
        }
        .wa-link-badge-pill {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(255, 79, 0, 0.1);
          border: 1px solid rgba(255, 79, 0, 0.22);
          color: #FF4F00;
          font-size: 7px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .wa-link-badge-dot {
          width: 3px;
          height: 3px;
          border-radius: 999px;
          background: #FF4F00;
        }
        .wa-link-headline { line-height: 1.08; }
        .wa-link-h-fade {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #1c1917;
          opacity: 0.85;
        }
        .wa-link-h-grad {
          font-size: 14px;
          font-weight: 800;
          letter-spacing: -0.03em;
          background: linear-gradient(90deg, #FF4F00, #ff8a3d);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .wa-link-buttons {
          display: inline-flex;
          gap: 4px;
          margin-top: 2px;
        }
        .wa-link-btn {
          padding: 3px 7px;
          border-radius: 5px;
          font-size: 7.5px;
          font-weight: 600;
          letter-spacing: 0.01em;
        }
        .wa-link-btn-primary {
          background: #FF4F00;
          color: #fff;
        }
        .wa-link-btn-sec {
          background: transparent;
          border: 1px solid #e7e5e4;
          color: #1c1917;
        }
        .wa-link-meta {
          padding: 8px 10px 9px;
        }
        .wa-link-title {
          font-size: 12.5px;
          font-weight: 600;
          color: #111b21;
          line-height: 1.3;
          margin-bottom: 2px;
        }
        .wa-link-desc {
          font-size: 11px;
          color: #3b4a54;
          line-height: 1.35;
          margin-bottom: 5px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .wa-link-domain {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10.5px;
          color: #667781;
          text-transform: lowercase;
          font-weight: 500;
        }
        .wa-link-favicon {
          display: inline-grid;
          place-items: center;
          width: 12px;
          height: 12px;
        }
        .wa-link-favicon svg {
          width: 12px;
          height: 12px;
        }
      `}</style>
    </a>
  );
}

function DoubleCheck() {
  return (
    <svg viewBox="0 0 16 15" fill="none" aria-hidden>
      <path
        d="M10.91 3.316 5.13 9.12l-2.055-2.06-.71.71 2.765 2.77L11.62 4.03l-.71-.714zm4.02 0-5.78 5.805-.74-.739-.714.71 1.454 1.454L15.65 4.03l-.72-.714zM1.5 8.05l2.765 2.77.71-.71L2.21 7.34l-.71.71z"
        fill="#53bdeb"
      />
    </svg>
  );
}
