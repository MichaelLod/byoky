import type { Metadata } from 'next';
import { FadeIn } from '../components/FadeIn';

export const metadata: Metadata = {
  title: 'Built with Byoky',
  description:
    'Apps and sites powered by Byoky — the open-source wallet for AI API keys.',
  openGraph: {
    title: 'Built with Byoky',
    description:
      'Apps and sites powered by Byoky — the open-source wallet for AI API keys.',
    url: 'https://byoky.com/built-with',
    siteName: 'Byoky',
    type: 'website',
  },
};

/* ─── Project Data ────────────────────────────── */

interface Project {
  name: string;
  url: string;
  description: string;
  category: string;
  color: string;
}

const projects: Project[] = [
  {
    name: 'LamboChart',
    url: 'https://lambochart.com',
    description:
      'AI-powered crypto charting and analysis. Users bring their own LLM keys via Byoky to power on-chain insights.',
    category: 'Crypto',
    color: '#f59e0b',
  },
];

/* ─── Page ────────────────────────────────────── */

export default function BuiltWith() {
  return (
    <>
      <section className="built-with-hero">
        <div className="built-with-glow" aria-hidden />
        <div className="container">
          <FadeIn>
            <h1>
              Built with <span className="hero-gradient">Byoky</span>
            </h1>
            <p className="built-with-subtitle">
              Apps that let users bring their own AI keys.
              Byoky handles key storage and proxying — developers just build.
            </p>
          </FadeIn>
        </div>
      </section>

      <div className="divider" />

      <section className="built-with-grid-section">
        <div className="container">
          <div className="built-with-grid">
            {projects.map((project) => (
              <FadeIn key={project.name}>
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="built-with-card"
                >
                  <div className="built-with-card-header">
                    <div
                      className="built-with-card-logo"
                      style={{ background: `${project.color}18`, color: project.color }}
                    >
                      {project.name[0]}
                    </div>
                    <div>
                      <h3>{project.name}</h3>
                      <span className="built-with-card-category">
                        {project.category}
                      </span>
                    </div>
                    <ExternalLinkIcon />
                  </div>
                  <p>{project.description}</p>
                </a>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <div className="divider" />

      <section className="built-with-cta-section">
        <div className="container">
          <FadeIn>
            <h2>Ship something with Byoky?</h2>
            <p className="built-with-cta-text">
              Open a PR to add your project to this page.
            </p>
            <a
              href="https://github.com/MichaelLod/byoky"
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon />
              Submit your project
            </a>
          </FadeIn>
        </div>
      </section>

      <Footer />
    </>
  );
}

/* ─── Footer ──────────────────────────────────── */

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <a href="/" className="footer-brand">Byoky</a>
          <div className="footer-links">
            <a
              href="https://github.com/MichaelLod/byoky"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a href="/demo">Demo</a>
            <a href="/built-with">Built with Byoky</a>
          </div>
          <span className="footer-note">
            Made for developers who care about key security.
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ─── Icons ───────────────────────────────────── */

function ExternalLinkIcon() {
  return (
    <svg className="built-with-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
