import { FadeIn } from './FadeIn';

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
            <div className="wa-phone">
              <div className="wa-phone-notch" aria-hidden />
              <div className="wa-phone-screen">
                <div className="wa-header">
                  <svg className="wa-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  <div className="wa-avatar">
                    <span>M</span>
                  </div>
                  <div className="wa-meta">
                    <div className="wa-name">Marco</div>
                    <div className="wa-status">online</div>
                  </div>
                  <div className="wa-actions">
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M15 10.5V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3.5l5 3.5V7l-5 3.5z" />
                    </svg>
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
                    </svg>
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <circle cx="12" cy="5" r="2" />
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="12" cy="19" r="2" />
                    </svg>
                  </div>
                </div>

                <div className="wa-chat">
                  <div className="wa-wallpaper" aria-hidden />
                  <div className="wa-messages">
                    <div className="wa-day">
                      <span>TODAY</span>
                    </div>

                    <div className="wa-row wa-row-in">
                      <div className="wa-bubble wa-bubble-in wa-tail-in">
                        yo bro, quick q 👀
                        <span className="wa-time">14:32</span>
                      </div>
                    </div>
                    <div className="wa-row wa-row-in">
                      <div className="wa-bubble wa-bubble-in">
                        how many tokens u got left on your anthropic sub this week?
                        <span className="wa-time">14:32</span>
                      </div>
                    </div>

                    <div className="wa-row wa-row-out">
                      <div className="wa-bubble wa-bubble-out wa-tail-out">
                        man i only used like <strong>6%</strong> this week 😎
                        <span className="wa-time">
                          14:33
                          <DoubleCheck />
                        </span>
                      </div>
                    </div>
                    <div className="wa-row wa-row-out">
                      <div className="wa-bubble wa-bubble-out">
                        what about you?
                        <span className="wa-time">
                          14:33
                          <DoubleCheck />
                        </span>
                      </div>
                    </div>

                    <div className="wa-row wa-row-in">
                      <div className="wa-bubble wa-bubble-in wa-tail-in">
                        dude... i already hit <strong>99%</strong> 💀
                        <span className="wa-time">14:34</span>
                      </div>
                    </div>
                    <div className="wa-row wa-row-in">
                      <div className="wa-bubble wa-bubble-in">
                        stuck for the rest of the week fr
                        <span className="wa-time">14:34</span>
                      </div>
                    </div>

                    <div className="wa-row wa-row-out">
                      <div className="wa-bubble wa-bubble-out wa-tail-out">
                        no problem, use mine via byoky 🤝
                        <span className="wa-time">
                          14:34
                          <DoubleCheck />
                        </span>
                      </div>
                    </div>
                    <div className="wa-row wa-row-out">
                      <div className="wa-bubble wa-bubble-out">
                        i got you covered
                        <span className="wa-time">
                          14:34
                          <DoubleCheck />
                        </span>
                      </div>
                    </div>

                    <div className="wa-row wa-row-out">
                      <div className="wa-bubble wa-bubble-out wa-bubble-link">
                        <a
                          href="https://byoky.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="wa-link-preview"
                        >
                          <div className="wa-link-image">
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path
                                d="M12 2 4 7v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V7l-8-5Z"
                                fill="#FF4F00"
                              />
                              <path
                                d="M9 12l2 2 4-4"
                                stroke="#fff"
                                strokeWidth="2.2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                fill="none"
                              />
                            </svg>
                            <span className="wa-link-badge">byoky.com</span>
                          </div>
                          <div className="wa-link-body">
                            <div className="wa-link-title">Byoky — The AI token network</div>
                            <div className="wa-link-desc">
                              Share your AI tokens with anyone, without sharing your API keys.
                              Budget-capped, revocable, encrypted.
                            </div>
                            <div className="wa-link-url">byoky.com</div>
                          </div>
                        </a>
                        <div className="wa-link-caption">
                          install it, ping me, i&apos;ll send a gift 🎁
                          <span className="wa-time">
                            14:35
                            <DoubleCheck />
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="wa-row wa-row-in">
                      <div className="wa-typing" aria-label="Marco is typing">
                        <span />
                        <span />
                        <span />
                      </div>
                    </div>
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
                      <path d="m21 15-5-5L4 22" />
                      <path d="M5 3h14a2 2 0 0 1 2 2v14" />
                    </svg>
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
            </div>
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
            <FadeIn delay={0.5}>
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
            radial-gradient(ellipse 60% 50% at 20% 30%, rgba(37, 211, 102, 0.10), transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 70%, rgba(255, 79, 0, 0.07), transparent 60%);
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

        .wa-layout {
          display: grid;
          grid-template-columns: minmax(280px, 360px) 1fr;
          gap: 72px;
          align-items: center;
        }

        /* ─── Phone frame ─────────────────────────── */
        .wa-phone {
          position: relative;
          width: 100%;
          max-width: 360px;
          margin: 0 auto;
          aspect-ratio: 360 / 740;
          border-radius: 44px;
          background: linear-gradient(145deg, #1f1f1f, #0a0a0a);
          padding: 12px;
          box-shadow:
            0 40px 80px -20px rgba(20, 83, 45, 0.35),
            0 20px 40px -10px rgba(0, 0, 0, 0.25),
            inset 0 0 0 1.5px rgba(255, 255, 255, 0.08);
        }
        .wa-phone-notch {
          position: absolute;
          top: 18px;
          left: 50%;
          transform: translateX(-50%);
          width: 96px;
          height: 28px;
          border-radius: 16px;
          background: #000;
          z-index: 3;
        }
        .wa-phone-screen {
          position: relative;
          height: 100%;
          border-radius: 34px;
          overflow: hidden;
          background: #efeae2;
          display: flex;
          flex-direction: column;
          isolation: isolate;
        }

        /* ─── Header ─────────────────────────────── */
        .wa-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 44px 12px 10px;
          background: #008069;
          color: #fff;
          flex-shrink: 0;
        }
        .wa-back {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          opacity: 0.95;
        }
        .wa-avatar {
          width: 36px;
          height: 36px;
          border-radius: 999px;
          background: linear-gradient(135deg, #ff8a3d, #FF4F00);
          display: grid;
          place-items: center;
          font-size: 15px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .wa-meta {
          flex: 1;
          min-width: 0;
          line-height: 1.2;
        }
        .wa-name {
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .wa-status {
          font-size: 12px;
          opacity: 0.85;
          margin-top: 1px;
        }
        .wa-actions {
          display: inline-flex;
          gap: 14px;
          color: #fff;
          opacity: 0.92;
        }
        .wa-actions svg {
          width: 20px;
          height: 20px;
        }

        /* ─── Chat ───────────────────────────────── */
        .wa-chat {
          flex: 1;
          position: relative;
          overflow: hidden;
        }
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
          padding: 8px 8px 12px;
          scrollbar-width: none;
        }
        .wa-messages::-webkit-scrollbar { display: none; }

        .wa-day {
          text-align: center;
          margin: 6px 0 10px;
        }
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

        .wa-row {
          display: flex;
          margin: 2px 0;
        }
        .wa-row-in { justify-content: flex-start; }
        .wa-row-out { justify-content: flex-end; }

        .wa-bubble {
          position: relative;
          max-width: 78%;
          padding: 7px 10px 8px;
          border-radius: 8px;
          font-size: 13.5px;
          line-height: 1.38;
          color: #111b21;
          word-wrap: break-word;
          box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
        }
        .wa-bubble strong {
          font-weight: 700;
        }
        .wa-bubble-in {
          background: #fff;
          border-top-left-radius: 8px;
        }
        .wa-bubble-out {
          background: #d9fdd3;
        }

        /* Tails (first bubble in a run) */
        .wa-tail-in {
          border-top-left-radius: 0;
        }
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
        .wa-tail-out {
          border-top-right-radius: 0;
        }
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
          margin-top: 4px;
          line-height: 1;
          position: relative;
          top: 4px;
        }
        .wa-time svg {
          width: 15px;
          height: 15px;
        }

        /* ─── Link preview ────────────────────────── */
        .wa-bubble-link {
          max-width: 82%;
          padding: 4px;
          overflow: hidden;
        }
        .wa-link-preview {
          display: block;
          border-radius: 6px;
          overflow: hidden;
          background: rgba(6, 95, 70, 0.06);
          margin-bottom: 4px;
        }
        .wa-link-image {
          position: relative;
          aspect-ratio: 16 / 9;
          background:
            radial-gradient(circle at 30% 40%, rgba(255, 138, 61, 0.35), transparent 60%),
            linear-gradient(135deg, #fff5ef, #ffe6d5);
          display: grid;
          place-items: center;
        }
        .wa-link-image svg {
          width: 68px;
          height: 68px;
          filter: drop-shadow(0 6px 16px rgba(255, 79, 0, 0.35));
        }
        .wa-link-badge {
          position: absolute;
          bottom: 8px;
          left: 8px;
          padding: 3px 8px;
          border-radius: 6px;
          background: rgba(17, 27, 33, 0.7);
          color: #fff;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .wa-link-body {
          padding: 8px 10px 10px;
        }
        .wa-link-title {
          font-size: 13px;
          font-weight: 600;
          color: #111b21;
          margin-bottom: 2px;
        }
        .wa-link-desc {
          font-size: 11.5px;
          color: #3b4a54;
          line-height: 1.35;
          margin-bottom: 4px;
        }
        .wa-link-url {
          font-size: 11px;
          color: #667781;
          text-transform: lowercase;
        }
        .wa-link-caption {
          padding: 2px 6px 4px;
          font-size: 13.5px;
          color: #111b21;
          line-height: 1.38;
        }

        /* ─── Typing indicator ────────────────────── */
        .wa-typing {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 10px 12px;
          background: #fff;
          border-radius: 8px;
          border-top-left-radius: 0;
          box-shadow: 0 1px 0.5px rgba(11, 20, 26, 0.13);
          margin-top: 4px;
        }
        .wa-typing span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #8696a0;
          display: inline-block;
          animation: wa-typing 1.3s infinite ease-in-out both;
        }
        .wa-typing span:nth-child(1) { animation-delay: -0.32s; }
        .wa-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes wa-typing {
          0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-2px); }
        }

        /* ─── Composer ────────────────────────────── */
        .wa-composer {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px 20px;
          background: #f0f2f5;
          flex-shrink: 0;
        }
        .wa-composer-input {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: #fff;
          border-radius: 999px;
          color: #54656f;
          font-size: 13px;
        }
        .wa-composer-input svg {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }
        .wa-composer-input span {
          flex: 1;
        }
        .wa-mic {
          width: 38px;
          height: 38px;
          border-radius: 999px;
          background: #008069;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .wa-mic svg {
          width: 20px;
          height: 20px;
        }

        /* ─── Copy column ─────────────────────────── */
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
        .wa-feature-icon svg {
          width: 22px;
          height: 22px;
        }
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

        @media (max-width: 860px) {
          .wa-layout {
            grid-template-columns: 1fr;
            gap: 48px;
          }
          .wa-head h2 { font-size: 34px; }
          .wa-phone { max-width: 320px; }
          .wa-copy { order: 2; }
        }
        @media (max-width: 480px) {
          .wa-head h2 { font-size: 28px; }
          .wa-subtitle { font-size: 15px; }
          .wa-phone { max-width: 300px; }
        }
      `}</style>
    </section>
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
