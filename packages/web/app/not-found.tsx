import type { Metadata } from 'next';
import { FadeIn } from './components/FadeIn';
import { Muninn } from './components/Muninn';

export const metadata: Metadata = {
  title: 'Page not found',
  description: "This page doesn't exist. Head back to byoky.com to find your way.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <section className="notfound">
      <div className="container notfound-inner">
        <FadeIn>
          <Muninn size={200} label="Muninn the raven, perched on a key, watching your cursor" className="notfound-raven" />
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="notfound-badge">
            &gt; Error 404<span className="cursor" aria-hidden>_</span>
          </div>
        </FadeIn>

        <FadeIn delay={0.2}>
          <h1>This key doesn&apos;t unlock anything.</h1>
        </FadeIn>

        <FadeIn delay={0.3}>
          <p>
            The page you&apos;re looking for isn&apos;t in the wallet. It may have moved,
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
            <a href="/demo">Demo</a>
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
          padding: 120px 0 96px;
        }
        .notfound::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: var(--scanlines);
          pointer-events: none;
          z-index: 3;
        }
        .notfound-inner {
          max-width: 680px;
        }
        .notfound-raven {
          display: block;
          margin: 0 auto 12px;
        }
        .notfound-badge {
          font-family: var(--font-code);
          font-size: 13px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--phosphor);
          margin-bottom: 14px;
        }
        .notfound h1 {
          font-size: clamp(30px, 5vw, 48px);
          line-height: 1.05;
          margin-bottom: 18px;
        }
        .notfound p {
          font-size: 17px;
          color: var(--fog);
          max-width: 480px;
          margin: 0 auto 36px;
          line-height: 1.65;
        }
        .notfound-actions {
          display: flex;
          gap: 12px;
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
          padding: 10px 16px;
          border: 1px solid var(--seam);
          background: var(--crypt);
          font-family: var(--font-code);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .notfound-links a {
          color: var(--fog);
          transition: color 0.15s ease;
        }
        .notfound-links a:hover {
          color: var(--phosphor);
        }
        @media (max-width: 720px) {
          .notfound { padding: 104px 0 72px; }
          .notfound-raven { width: 160px; height: 160px; }
          .notfound p { font-size: 15px; }
        }
      `}</style>
    </section>
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
