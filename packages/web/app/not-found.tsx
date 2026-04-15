import type { Metadata } from 'next';
import { FadeIn } from './components/FadeIn';

export const metadata: Metadata = {
  title: 'Page not found',
  description: "This page isn't in the vault. Head back to byoky.com to find your way.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section className="notfound">
      <div className="notfound-glow" aria-hidden />
      <div className="notfound-glow-secondary" aria-hidden />
      <div className="container notfound-inner">
        <FadeIn>
          <div className="notfound-badge">
            <span className="notfound-badge-dot" />
            Error 404
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="notfound-code" aria-hidden>
            <span>4</span>
            <KeyGlyph />
            <span>4</span>
          </div>
        </FadeIn>

        <FadeIn delay={0.2}>
          <h1>This key doesn&apos;t unlock anything.</h1>
        </FadeIn>

        <FadeIn delay={0.3}>
          <p>
            The page you&apos;re looking for isn&apos;t in the vault. It may have moved,
            been renamed, or never existed at all.
          </p>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="notfound-actions">
            <a href="/" className="btn btn-primary">
              <HomeIcon />
              Back to home
            </a>
            <a href="/docs" className="btn btn-secondary">
              Read the docs
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.5}>
          <div className="notfound-links">
            <span>Try instead:</span>
            <a href="/token-pool">Token Pool</a>
            <span aria-hidden>·</span>
            <a href="/openclaw">OpenClaw</a>
            <span aria-hidden>·</span>
            <a href="/blog">Blog</a>
            <span aria-hidden>·</span>
            <a href="/support">Support</a>
          </div>
        </FadeIn>
      </div>

      <style>{`
        .notfound {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 140px 0 120px;
          position: relative;
          overflow: hidden;
        }
        .notfound-inner {
          position: relative;
          z-index: 2;
          max-width: 640px;
        }
        .notfound-glow {
          position: absolute;
          top: -20%;
          left: 50%;
          transform: translateX(-50%);
          width: 900px;
          height: 600px;
          background: radial-gradient(
            ellipse at center,
            rgba(255, 79, 0, 0.08) 0%,
            rgba(255, 79, 0, 0.02) 40%,
            transparent 70%
          );
          filter: blur(70px);
          animation: aurora-1 14s ease-in-out infinite;
          pointer-events: none;
        }
        .notfound-glow-secondary {
          position: absolute;
          top: 10%;
          left: 50%;
          transform: translateX(-50%);
          width: 700px;
          height: 450px;
          background: radial-gradient(
            ellipse at 50% 60%,
            rgba(2, 132, 199, 0.05) 0%,
            rgba(22, 163, 74, 0.02) 45%,
            transparent 70%
          );
          filter: blur(80px);
          animation: aurora-2 18s ease-in-out infinite;
          pointer-events: none;
        }
        .notfound-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 100px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 32px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .notfound-badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--teal);
          box-shadow: 0 0 8px var(--teal-glow);
          animation: dot-pulse 2s ease-in-out infinite;
        }
        .notfound-code {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          font-family: var(--font-sans);
          font-size: 168px;
          font-weight: 700;
          line-height: 1;
          letter-spacing: -0.05em;
          margin-bottom: 28px;
          color: var(--text);
        }
        .notfound-code span {
          background: linear-gradient(
            180deg,
            var(--text) 0%,
            rgba(28, 25, 23, 0.55) 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .notfound-code svg {
          width: 128px;
          height: 128px;
          color: var(--teal);
          filter: drop-shadow(0 10px 30px var(--teal-glow));
          animation: float 6s ease-in-out infinite;
        }
        .notfound h1 {
          font-size: 40px;
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.1;
          margin-bottom: 18px;
          color: var(--text);
        }
        .notfound p {
          font-size: 17px;
          color: var(--text-secondary);
          max-width: 480px;
          margin: 0 auto 40px;
          line-height: 1.65;
        }
        .notfound-actions {
          display: flex;
          gap: 14px;
          justify-content: center;
          flex-wrap: wrap;
          margin-bottom: 32px;
        }
        .notfound-actions .btn svg {
          width: 16px;
          height: 16px;
        }
        .notfound-links {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
          font-size: 13px;
          color: var(--text-muted);
          padding: 10px 18px;
          border-radius: 100px;
          border: 1px solid var(--border);
          background: var(--bg-surface);
        }
        .notfound-links a {
          color: var(--text-secondary);
          transition: color 0.2s ease;
        }
        .notfound-links a:hover {
          color: var(--teal-light);
        }
        .notfound-links span[aria-hidden] {
          color: var(--text-muted);
          opacity: 0.6;
        }
        @media (max-width: 720px) {
          .notfound { padding: 120px 0 80px; }
          .notfound-code { font-size: 112px; gap: 12px; }
          .notfound-code svg { width: 88px; height: 88px; }
          .notfound h1 { font-size: 30px; }
          .notfound p { font-size: 15px; }
        }
        @media (max-width: 480px) {
          .notfound-code { font-size: 88px; gap: 8px; }
          .notfound-code svg { width: 68px; height: 68px; }
        }
      `}</style>
    </section>
  );
}

function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="12" r="5" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" />
      <path d="M13 12h9" />
      <path d="M18 12v3.5" />
      <path d="M21 12v2.5" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
