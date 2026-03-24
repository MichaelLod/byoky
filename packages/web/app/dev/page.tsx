import type { Metadata } from 'next';
import { FadeIn } from '../components/FadeIn';
import './dev.css';

export const metadata: Metadata = {
  title: 'Developer Hub',
  description: 'Build AI apps on Byoky in 5 minutes. Templates, recipes, and guides to ship fast.',
  alternates: { canonical: '/dev' },
};

export default function DevHub() {
  return (
    <>
      <Hero />
      <div className="divider" />
      <QuickStart />
      <div className="divider" />
      <Templates />
      <div className="divider" />
      <Recipes />
      <div className="divider" />
      <LaunchChecklist />
      <div className="divider" />
      <CallToAction />
      <Footer />
    </>
  );
}

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="dh-hero">
      <div className="dh-hero-glow" aria-hidden />
      <div className="container">
        <FadeIn>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Developer Hub
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1>
            Build on Byoky.<br />
            <span className="hero-gradient">Ship in minutes.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            Everything you need to build AI apps where users bring their own
            keys. Zero API costs. Zero key management. Just code.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="dh-hero-actions">
            <div className="install-cmd">
              <code>npx create-byoky-app</code>
            </div>
            <a
              href="https://github.com/MichaelLod/byoky"
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon />
              View on GitHub
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Quick Start ──────────────────────────────── */

function QuickStart() {
  return (
    <section className="dh-quickstart">
      <div className="container">
        <FadeIn>
          <h2>Get started in 3 steps</h2>
          <p className="dh-subtitle">
            From zero to AI-powered app in under a minute.
          </p>
        </FadeIn>
        <div className="dh-steps-grid">
          <FadeIn delay={0.1}>
            <div className="dh-step">
              <div className="dh-step-number">1</div>
              <h3>Install</h3>
              <div className="code-window">
                <div className="code-titlebar">
                  <span className="code-dot code-dot-red" />
                  <span className="code-dot code-dot-yellow" />
                  <span className="code-dot code-dot-green" />
                  <span className="code-filename">terminal</span>
                </div>
                <div className="code-body">
                  <pre><code>npm install @byoky/sdk</code></pre>
                </div>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="dh-step">
              <div className="dh-step-number">2</div>
              <h3>Connect</h3>
              <div className="code-window">
                <div className="code-titlebar">
                  <span className="code-dot code-dot-red" />
                  <span className="code-dot code-dot-yellow" />
                  <span className="code-dot code-dot-green" />
                  <span className="code-filename">app.ts</span>
                </div>
                <div className="code-body">
                  <pre><code>{`import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic' }],
  modal: true,
});`}</code></pre>
                </div>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="dh-step">
              <div className="dh-step-number">3</div>
              <h3>Use</h3>
              <div className="code-window">
                <div className="code-titlebar">
                  <span className="code-dot code-dot-red" />
                  <span className="code-dot code-dot-yellow" />
                  <span className="code-dot code-dot-green" />
                  <span className="code-filename">app.ts</span>
                </div>
                <div className="code-body">
                  <pre><code>{`const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});`}</code></pre>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Templates ────────────────────────────────── */

const templates = [
  {
    name: 'AI Chat',
    letter: 'C',
    color: '#0ea5e9',
    description: 'Multi-provider chat with streaming. Works with Anthropic, OpenAI, Gemini.',
    tech: ['Next.js', 'React'],
  },
  {
    name: 'Code Assistant',
    letter: 'A',
    color: '#86efac',
    description: 'Editor with AI completions. Monaco editor + streaming.',
    tech: ['Vite', 'TypeScript'],
  },
  {
    name: 'Agent Sandbox',
    letter: 'S',
    color: '#c084fc',
    description: 'Tool-using AI agent with function calling. Multi-step reasoning.',
    tech: ['Next.js', 'React'],
  },
  {
    name: 'Backend Relay',
    letter: 'R',
    color: '#f59e0b',
    description: 'Server-side LLM calls through user\u2019s wallet via WebSocket.',
    tech: ['Express', 'Node.js'],
  },
];

function Templates() {
  return (
    <section className="dh-templates">
      <div className="container">
        <FadeIn>
          <h2>Start from a template</h2>
          <p className="dh-subtitle">
            Production-ready starters. Clone, customize, ship.
          </p>
        </FadeIn>
        <div className="dh-templates-grid">
          {templates.map((t, i) => (
            <FadeIn key={t.name} delay={0.05 + i * 0.08}>
              <a href="#" className="dh-template-card">
                <div className="dh-template-header">
                  <div
                    className="dh-template-icon"
                    style={{
                      background: `${t.color}15`,
                      color: t.color,
                    }}
                  >
                    {t.letter}
                  </div>
                  <h3>{t.name}</h3>
                </div>
                <p>{t.description}</p>
                <div className="dh-template-footer">
                  <div className="dh-template-tags">
                    {t.tech.map((tag) => (
                      <span key={tag} className="dh-template-tag">{tag}</span>
                    ))}
                  </div>
                  <span className="dh-template-link">
                    Use template &rarr;
                  </span>
                </div>
              </a>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Recipes ──────────────────────────────────── */

const recipes = [
  {
    title: 'Streaming Chat with Anthropic',
    description: 'Full streaming with the native Anthropic SDK. Keys never leave the wallet.',
    filename: 'anthropic-stream.ts',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const event of stream) {
  process.stdout.write(event.delta.text);
}`,
  },
  {
    title: 'OpenAI Chat Completions',
    description: 'Use the official OpenAI SDK with zero config changes.',
    filename: 'openai-chat.ts',
    code: `import OpenAI from 'openai';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'openai', required: true }],
  modal: true,
});

const openai = new OpenAI({
  apiKey: session.sessionKey,
  fetch: session.createFetch('openai'),
  dangerouslyAllowBrowser: true,
});

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);`,
  },
  {
    title: 'Multi-Provider Fallback',
    description: 'Let users connect whichever provider they have. Use whatever is available.',
    filename: 'multi-provider.ts',
    code: `import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [
    { id: 'anthropic' },
    { id: 'openai' },
    { id: 'gemini' },
  ],
  modal: true,
});

// Use whichever provider the user has
const available = Object.keys(session.providers);
const fetch = session.createFetch(available[0]);`,
  },
  {
    title: 'Backend Relay',
    description: 'Server-side LLM calls through the user\u2019s wallet. Keys never touch your server.',
    filename: 'relay.ts',
    code: `// === Frontend ===
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});
session.createRelay('wss://your-app.com/ws/relay');

// === Backend (Node.js) ===
import { ByokyServer } from '@byoky/sdk/server';

const byoky = new ByokyServer();
wss.on('connection', async (ws) => {
  const client = await byoky.handleConnection(ws);
  const fetch = client.createFetch('anthropic');
  // Make LLM calls with the user's keys
});`,
  },
  {
    title: 'Mobile QR Pairing',
    description: 'No extension installed? Users scan a QR code with the Byoky mobile app.',
    filename: 'mobile-qr.ts',
    code: `import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic' }],
  useRelay: true,
  modal: true, // Shows QR code automatically
});

// Works exactly the same as extension mode
const fetch = session.createFetch('anthropic');`,
  },
  {
    title: 'Extension Detection',
    description: 'Detect the extension, show install prompts, and fall back to QR pairing.',
    filename: 'detect.ts',
    code: `import { Byoky, isExtensionInstalled, getStoreUrl } from '@byoky/sdk';

if (!await isExtensionInstalled()) {
  const storeUrl = getStoreUrl(); // Auto-detects browser
  // Show install prompt with storeUrl
}

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic' }],
  modal: true, // Handles detection + QR fallback
});`,
  },
];

function Recipes() {
  return (
    <section className="dh-recipes">
      <div className="container">
        <FadeIn>
          <h2>Recipes</h2>
          <p className="dh-subtitle">
            Copy-paste patterns for common use cases. Each one works out of the box.
          </p>
        </FadeIn>
        <div className="dh-recipes-list">
          {recipes.map((r, i) => (
            <FadeIn key={r.title} delay={0.05 + i * 0.06}>
              <div className="dh-recipe-card">
                <div className="dh-recipe-header">
                  <h3>{r.title}</h3>
                  <p>{r.description}</p>
                </div>
                <div className="code-window">
                  <div className="code-titlebar">
                    <span className="code-dot code-dot-red" />
                    <span className="code-dot code-dot-yellow" />
                    <span className="code-dot code-dot-green" />
                    <span className="code-filename">{r.filename}</span>
                  </div>
                  <div className="code-body">
                    <pre><code>{r.code}</code></pre>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Launch Checklist ─────────────────────────── */

const checklistItems = [
  { text: 'Handle extension detection and show install prompt' },
  {
    text: (
      <>Add mobile fallback with <code>useRelay: true</code> and <code>modal: true</code></>
    ),
  },
  {
    text: (
      <>Handle <code>session.onDisconnect()</code> for wallet revocation</>
    ),
  },
  {
    text: (
      <>Listen for <code>session.onProvidersUpdated()</code> for key changes</>
    ),
  },
  { text: 'Set error boundaries for network/proxy failures' },
  { text: 'Add "Built with Byoky" badge (optional, we love you)' },
];

function LaunchChecklist() {
  return (
    <section className="dh-checklist">
      <div className="container">
        <FadeIn>
          <h2>Launch checklist</h2>
          <p className="dh-subtitle">
            Ship with confidence. Make sure you&apos;ve covered the essentials.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="dh-checklist-card">
            <ul className="dh-checklist-list">
              {checklistItems.map((item, i) => (
                <li key={i} className="dh-checklist-item">
                  <span className="dh-checklist-icon">
                    <CheckIcon />
                  </span>
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── CTA + Footer ─────────────────────────────── */

function CallToAction() {
  return (
    <section className="dh-cta">
      <div className="container">
        <FadeIn>
          <h2>
            Ready to build?
          </h2>
          <p>
            Start with a template, explore the recipes, or dive straight into
            the SDK. Your users&apos; keys, your app, zero API costs.
          </p>
          <div className="dh-cta-links">
            <a href="/demo" className="btn btn-primary">
              Try the Demo
            </a>
            <a
              href="https://github.com/MichaelLod/byoky"
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon />
              GitHub
            </a>
            <a href="/built-with" className="btn btn-secondary">
              Built with Byoky
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <span className="footer-brand">Byoky</span>
          <div className="footer-links">
            <a
              href="https://github.com/MichaelLod/byoky"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a href="/demo">
              Demo
            </a>
            <a href="/built-with">
              Built with Byoky
            </a>
            <a
              href="https://github.com/MichaelLod/byoky/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
            >
              MIT License
            </a>
          </div>
          <span className="footer-note">
            Made for developers who care about key security.
          </span>
        </div>
      </div>
    </footer>
  );
}

/* ─── Icons (inline SVG) ───────────────────────── */

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
