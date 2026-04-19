import type { Metadata } from 'next';
import { InstallWithAI } from './InstallWithAI';

export const metadata: Metadata = {
  title: 'Run OpenClaw with Byoky — free, no API credits required',
  description:
    'Use OpenClaw — the open-source AI agent CLI — with Claude, GPT, Gemini and 10 more providers. Pair it with a free Byoky token gift or your existing Claude Pro/Max subscription and run frontier models at zero extra cost.',
  alternates: {
    canonical: '/openclaw',
  },
  openGraph: {
    title: 'Run OpenClaw with Byoky — free, no API credits required',
    description:
      'Use OpenClaw with Claude, GPT, and Gemini for free. Grab a token gift from the Byoky token pool, or sign in with your Claude Pro/Max subscription. Up in 5 minutes.',
    url: 'https://byoky.com/openclaw',
    type: 'article',
    images: [
      {
        url: '/openclaw-og.png',
        width: 1200,
        height: 630,
        alt: 'Run Claude Code, Codex, and Gemini in OpenClaw — with Byoky',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Run OpenClaw with Byoky — free, no API credits required',
    description:
      'Use OpenClaw with Claude, GPT, and Gemini for free. Grab a token gift from the token pool, or sign in with your Claude Pro/Max subscription.',
    images: ['/openclaw-og.png'],
  },
};

export default function OpenClawTutorial() {
  return (
    <div className="oc-page">
      <div className="container oc-container">
        <Hero />
        <FreeCallout />
        <Step
          n={1}
          title="Install the Byoky wallet"
          subtitle="The wallet holds API keys (yours or gifted) and proxies every request."
        >
          <p>Pick the version for your machine:</p>
          <div className="oc-install-grid">
            <a
              className="oc-install-card"
              href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>
              <span>Chrome</span>
            </a>
            <a
              className="oc-install-card"
              href="https://addons.mozilla.org/en-US/firefox/addon/byoky/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M38 18c-1-4-4-7-8-9 2 2 3 5 3 7 0 3-2 6-5 7-4 1-7-1-7-1s1 5 6 6c4 1 8-1 10-4 1-1 1-3 1-6z" fill="#FF4F00"/><path d="M14 30c-1-3 0-6 2-9 1-2 3-3 5-4-2 2-3 4-2 7 0 2 2 4 4 5 3 1 6 0 7-2-1 3-4 6-8 6-3 1-6-1-8-3z" fill="#FF9500"/></svg>
              <span>Firefox</span>
            </a>
            <a
              className="oc-install-card"
              href="https://apps.apple.com/app/byoky/id6760779919"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#999"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              <span>iOS</span>
            </a>
            <a
              className="oc-install-card"
              href="https://play.google.com/store/apps/details?id=com.byoky.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#3DDC84"><path d="M17.523 15.341a.91.91 0 0 0 .916-.907V9.478a.91.91 0 0 0-.916-.907.91.91 0 0 0-.917.907v4.956a.91.91 0 0 0 .917.907zm-11.046 0a.91.91 0 0 0 .917-.907V9.478a.91.91 0 0 0-.917-.907.91.91 0 0 0-.916.907v4.956a.91.91 0 0 0 .916.907zm1.48 5.178c0 .504.41.912.916.912h.95v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h1.688v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h.95a.914.914 0 0 0 .916-.913V8.879H7.957v11.64zM15.4 3.11l1.124-1.727a.235.235 0 0 0-.073-.324.237.237 0 0 0-.326.072l-1.14 1.75A6.813 6.813 0 0 0 12 2.321c-1.07 0-2.08.195-3.003.56L7.857 1.13a.236.236 0 0 0-.325-.072.235.235 0 0 0-.073.324L8.583 3.11C6.572 4.12 5.204 6.071 5.204 8.338h13.592c0-2.267-1.368-4.219-3.396-5.228z"/></svg>
              <span>Android</span>
            </a>
          </div>
          <p className="oc-note">
            Open the wallet, set a password, and you&apos;re ready. No accounts, no email.
          </p>
        </Step>

        <Step
          n={2}
          title="Add a credential"
          subtitle="Three options — pick whichever fits."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="oc-option-card">
              <strong>Free token gift</strong> — grab one from the{' '}
              <a className="oc-link" href="/token-pool">Token Pool</a>. No API key needed.
            </div>
            <div className="oc-option-card">
              <strong>Claude Pro/Max setup token</strong> — run <code>claude setup-token</code> in your terminal and paste it into Byoky.
            </div>
            <div className="oc-option-card">
              <strong>Your own API key</strong> — add it directly in the wallet.
            </div>
          </div>
        </Step>

        <Step
          n={3}
          title="Install Byoky for OpenClaw"
          subtitle="One command installs the plugin and its bridge dependency."
        >
          <Code>{`openclaw plugins install @byoky/openclaw-plugin`}</Code>
          <p className="oc-note">
            The plugin registers all 13 Byoky providers with OpenClaw and
            pulls in <code>@byoky/bridge</code>, the tiny local HTTP proxy
            that lets OpenClaw talk to your wallet. The native messaging host
            is registered on the next step when you first connect — no extra
            command.
          </p>
          <InstallWithAI />
        </Step>

        <Step
          n={4}
          title="Connect OpenClaw to your wallet"
          subtitle="One command connects every provider you have in the wallet."
        >
          <Code>{`openclaw models auth login --provider byoky`}</Code>
          <p>
            First run: OpenClaw asks to register the native messaging host
            (press <strong>Enter</strong> to accept), then opens your browser
            so the wallet can approve the connection. Every provider you have
            in the wallet — Anthropic, OpenAI, Gemini, whatever — gets
            configured in one shot.
          </p>
          <p className="oc-note">
            Want just one provider? Use{' '}
            <code>--provider byoky-anthropic</code> (or{' '}
            <code>byoky-openai</code>, <code>byoky-gemini</code>,{' '}
            <code>byoky-xai</code>, etc.) instead.
          </p>
          <p>Verify the bridge:</p>
          <Code>
            {`curl http://127.0.0.1:19280/health
# → {"status":"ok","providers":["anthropic","openai",...]}`}
          </Code>
          <p className="oc-note oc-note-muted">
            Subsequent runs skip the browser tab if the bridge is already live
            — they just re-use the session.
          </p>
        </Step>

        <Step
          n={5}
          title="Use OpenClaw"
          subtitle="That's the whole setup. Run OpenClaw as you normally would — every LLM call routes through your wallet."
        >
          <p>
            Inside OpenClaw, the <code>/byoky</code> command shows bridge
            status and lists every connected provider:
          </p>
          <Code>{`/byoky`}</Code>
          <p>
            Token usage is tracked in your wallet&apos;s{' '}
            <strong>Sessions</strong> view. If you&apos;re using a gifted
            credential, the gifter&apos;s budget ticks down in real time and
            stops you cleanly when it hits zero.
          </p>
        </Step>

        <Providers />
        <HowItWorks />
        <Closing />
      </div>

      <style>{styles}</style>
    </div>
  );
}

/* ─── Sections ─────────────────────────────────── */

function Hero() {
  const products = [
    { name: 'Claude Code', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg' },
    { name: 'Codex', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg' },
    { name: 'Gemini CLI', icon: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg' },
  ];

  return (
    <header className="oc-hero">
      <div className="oc-eyebrow">OpenClaw × Byoky</div>
      <h1>Run AI agents in OpenClaw — for free.</h1>
      <div style={{
        display: 'flex', gap: '16px', justifyContent: 'center',
        flexWrap: 'wrap', margin: '24px 0',
      }}>
        {products.map((p) => (
          <div key={p.name} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '15px', fontWeight: 600,
            color: 'var(--text)',
          }}>
            <img src={p.icon} alt="" width={22} height={22} />
            {p.name}
          </div>
        ))}
      </div>
      <p className="oc-lede">
        Grab a free token gift or use your Claude Pro/Max subscription.<br />
        Zero extra cost. Keys never exposed.
      </p>
      <div className="oc-cta-row" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <a className="btn btn-primary" href="#step-1" style={{ minWidth: '220px', textAlign: 'center', justifyContent: 'center' }}>
          Start Setup
        </a>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>or</span>
        <InstallWithAI />
      </div>
    </header>
  );
}

function FreeCallout() {
  return (
    <div className="oc-paths">
      <div className="oc-paths-heading">Two ways to run OpenClaw for free</div>
      <div className="oc-paths-grid">
        <div className="oc-path-card">
          <div className="oc-path-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v10H4V12" />
              <path d="M2 7h20v5H2z" />
              <path d="M12 22V7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          </div>
          <h3>Token gift from the token pool</h3>
          <p>
            Anyone can gift token access on the{' '}
            <a className="oc-link" href="/token-pool">
              Byoky token pool
            </a>
            . OpenClaw runs entirely on the gifter&apos;s budget — capped,
            revocable, and proxied through their wallet so their key never
            leaves their machine.
          </p>
          <p className="oc-path-tag">No card, no signup, no provider account.</p>
        </div>
        <div className="oc-path-card">
          <div className="oc-path-icon" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <h3>Your Claude Pro/Max subscription</h3>
          <p>
            Already paying for Claude Pro or Max? Connect it to Byoky with a
            setup token and OpenClaw runs on the same subscription credits you
            already use in <code>claude.ai</code>. <strong>No API credits, no
            per-token billing.</strong>
          </p>
          <p className="oc-path-tag">Anthropic-only — uses your existing plan.</p>
        </div>
      </div>
    </div>
  );
}

function Overview() {
  return (
    <section className="oc-overview">
      <h2>What you&apos;ll do</h2>
      <div className="oc-overview-grid">
        <div className="oc-overview-card">
          <span className="oc-overview-num">1</span>
          <h3>Install the wallet</h3>
          <p>Chrome, Firefox, iOS, or Android — one click.</p>
        </div>
        <div className="oc-overview-card">
          <span className="oc-overview-num">2</span>
          <h3>Get free tokens</h3>
          <p>Redeem a gift from the token pool, or use your own key.</p>
        </div>
        <div className="oc-overview-card">
          <span className="oc-overview-num">3</span>
          <h3>Install the plugin</h3>
          <p>One npm install. Plugin pulls in the bridge.</p>
        </div>
        <div className="oc-overview-card">
          <span className="oc-overview-num">4</span>
          <h3>Run OpenClaw</h3>
          <p>One auth command and you&apos;re calling Claude / GPT / Gemini.</p>
        </div>
      </div>
    </section>
  );
}

function Providers() {
  const rows: [string, string, string, string][] = [
    ['Anthropic', 'byoky-anthropic', 'Claude Opus 4, Sonnet 4, Haiku 4.5', 'claude'],
    ['OpenAI', 'byoky-openai', 'GPT-4.1, o3, o4-mini, GPT-4.1 Mini', 'openai'],
    ['Google Gemini', 'byoky-gemini', 'Gemini 2.5 Pro, 2.5 Flash', 'gemini'],
    ['xAI', 'byoky-xai', 'Grok 3, Grok 3 Mini', 'grok'],
    ['DeepSeek', 'byoky-deepseek', 'DeepSeek V3, R1', 'deepseek'],
    ['Mistral', 'byoky-mistral', 'Mistral Large', 'mistral'],
    ['Groq', 'byoky-groq', 'Llama 3.3 70B', 'groq'],
    ['Cohere', 'byoky-cohere', 'Set model manually', 'cohere'],
    ['Perplexity', 'byoky-perplexity', 'Set model manually', 'perplexity'],
    ['Together AI', 'byoky-together', 'Set model manually', 'together'],
    ['Fireworks AI', 'byoky-fireworks', 'Set model manually', 'fireworks'],
    ['OpenRouter', 'byoky-openrouter', 'Set model manually', 'openrouter'],
    ['Azure OpenAI', 'byoky-azure_openai', 'Set model manually', 'azureai'],
  ];
  return (
    <section className="oc-section">
      <h2>Available providers</h2>
      <p>The plugin registers all 13 Byoky providers with OpenClaw:</p>
      <div className="oc-table">
        <div className="oc-table-head">
          <span>Provider</span>
          <span>OpenClaw ID</span>
          <span>Models</span>
        </div>
        {rows.map(([name, id, models, icon]) => (
          <div className="oc-table-row" key={id}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img src={`https://unpkg.com/@lobehub/icons-static-svg@latest/icons/${icon}.svg`} alt="" width={16} height={16} />
              {name}
            </span>
            <code>{id}</code>
            <span className="oc-table-models">{models}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="oc-section">
      <h2>How it works</h2>
      <Code>
        {`OpenClaw → HTTP → Bridge (localhost:19280) → Native Messaging → Extension → LLM API
                                                                ↑
                                                       Keys live here. Always.`}
      </Code>
      <ol className="oc-list">
        <li>The plugin registers each Byoky provider in OpenClaw, pointing at <code>http://127.0.0.1:19280/&lt;provider&gt;</code>.</li>
        <li>OpenClaw sends an LLM request to the local bridge.</li>
        <li>The bridge relays the request to your Byoky extension via Chrome native messaging.</li>
        <li>The extension injects the real API key (yours or a gifted one) and calls the provider.</li>
        <li>The response streams back through the same path.</li>
      </ol>
      <p>
        If you&apos;re using a gifted credential, requests are relayed once
        more — through the gifter&apos;s extension, which holds the real key
        and enforces the token budget. You see streaming tokens; the gifter
        sees a usage counter ticking down.
      </p>
    </section>
  );
}

function Closing() {
  return (
    <section className="oc-closing">
      <h2>Ready to try it?</h2>
      <p>
        Grab a free token gift from the token pool and you&apos;ll be running
        Claude or GPT inside OpenClaw in under five minutes.
      </p>
      <div className="oc-cta-row">
        <a className="btn btn-primary" href="/token-pool">
          Browse free gifts
        </a>
        <a
          className="btn btn-secondary"
          href="https://github.com/MichaelLod/byoky/tree/main/packages/openclaw-plugin"
          target="_blank"
          rel="noopener noreferrer"
        >
          Plugin on GitHub
        </a>
      </div>
    </section>
  );
}

/* ─── Components ────────────────────────────────── */

function Step({
  n,
  title,
  subtitle,
  highlight,
  children,
}: {
  n: number;
  title: string;
  subtitle: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={`step-${n}`} className={`oc-step ${highlight ? 'oc-step-highlight' : ''}`}>
      <div className="oc-step-head">
        <span className="oc-step-num">{n}</span>
        <div>
          <h2>{title}</h2>
          <p className="oc-step-sub">{subtitle}</p>
        </div>
      </div>
      <div className="oc-step-body">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="oc-code">
      <code>{children}</code>
    </pre>
  );
}

/* ─── Styles ────────────────────────────────────── */

const styles = `
.oc-page {
  --oc-bg-card: #ffffff;
  --oc-bg-elevated: #f5f5f4;
  --oc-border: #e7e5e4;
  --oc-border-strong: #d6d3d1;
  color: var(--text);
}

.oc-container {
  max-width: 820px;
  padding-top: 120px;
  padding-bottom: 96px;
}

/* ── Hero ── */
.oc-hero { margin-bottom: 56px; text-align: center; }
.oc-eyebrow {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--teal);
  background: rgba(255, 79, 0, 0.08);
  border: 1px solid rgba(255, 79, 0, 0.25);
  padding: 6px 12px;
  border-radius: 999px;
  margin-bottom: 22px;
}
.oc-hero h1 {
  font-size: 44px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 18px;
}
.oc-hero-sub-line { color: var(--text); }
.oc-grad {
  background: linear-gradient(90deg, var(--teal-light), var(--teal));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.oc-lede {
  font-size: 17px;
  line-height: 1.65;
  color: var(--text-secondary);
  max-width: 680px;
  margin: 0 0 28px;
}
.oc-cta-row { display: flex; gap: 12px; flex-wrap: wrap; }
.oc-hero-ai {
  margin: 24px auto 0;
  max-width: 640px;
  text-align: left;
}

/* ── Install with AI CTA ── */
.oc-ai-cta {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 20px;
  background: var(--oc-bg-card);
  border: 1px solid var(--oc-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}
.oc-ai-cta-text { min-width: 0; }
.oc-ai-cta-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}
.oc-ai-cta-spark { color: var(--teal); font-size: 14px; }
.oc-ai-cta-subtitle {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.oc-ai-cta-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--text);
  color: var(--oc-bg-card);
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  font-family: inherit;
}
.oc-ai-cta-btn:hover { background: #000; }
.oc-ai-cta-btn:active { transform: translateY(1px); }
.oc-ai-cta-btn.copied { background: var(--teal); color: #fff; }
@media (max-width: 640px) {
  .oc-ai-cta { flex-direction: column; align-items: stretch; gap: 14px; }
  .oc-ai-cta-btn { justify-content: center; }
}

/* ── Two free paths ── */
.oc-paths {
  margin-bottom: 64px;
}
.oc-paths-heading {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-bottom: 12px;
  padding-left: 2px;
}
.oc-paths-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.oc-path-card {
  padding: 22px 22px 18px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(14,165,233,0.08), rgba(14,165,233,0.02));
  border: 1px solid rgba(14, 165, 233, 0.28);
  display: flex;
  flex-direction: column;
}
.oc-path-card h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--text);
}
.oc-path-card p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0 0 10px;
}
.oc-path-card strong { color: var(--text); }
.oc-path-card code {
  font-family: var(--font-mono), monospace;
  font-size: 12px;
  background: var(--oc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--teal-light);
}
.oc-path-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(14, 165, 233, 0.18);
  color: var(--teal-light);
  margin-bottom: 14px;
}
.oc-path-tag {
  margin-top: auto !important;
  padding-top: 6px;
  font-size: 12px !important;
  color: var(--text-muted) !important;
}

/* ── Sub-card (alternative inside a step) ── */
.oc-option-card {
  padding: 12px 16px;
  border-radius: 8px;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e5e5);
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.oc-option-card strong { color: var(--text); }
.oc-option-card code {
  background: var(--bg-elevated, #f5f5f4);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
}

.oc-sub-card {
  margin-top: 22px;
  padding: 18px 20px 14px;
  border: 1px dashed var(--oc-border-strong);
  border-radius: 12px;
  background: rgba(14, 165, 233, 0.025);
}
.oc-sub-card-head {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--teal-light);
  margin-bottom: 10px;
}
.oc-sub-card p {
  font-size: 14px;
  line-height: 1.6;
  margin: 10px 0;
}

/* ── Overview ── */
.oc-overview { margin-bottom: 64px; }
.oc-overview h2 {
  font-size: 22px;
  margin: 0 0 18px;
}
.oc-overview-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.oc-overview-card {
  position: relative;
  padding: 18px 18px 16px;
  border: 1px solid var(--oc-border);
  border-radius: 12px;
  background: var(--oc-bg-card);
}
.oc-overview-num {
  position: absolute;
  top: 14px;
  right: 16px;
  font-size: 28px;
  font-weight: 700;
  color: var(--oc-border-strong);
  font-family: var(--font-mono), monospace;
  line-height: 1;
}
.oc-overview-card h3 {
  font-size: 15px;
  margin: 0 0 6px;
  color: var(--text);
  padding-right: 32px;
}
.oc-overview-card p {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

/* ── Steps ── */
.oc-step {
  margin-bottom: 12px;
  padding: 28px 28px 24px;
  border: 1px solid var(--oc-border);
  border-radius: 16px;
  background: var(--oc-bg-card);
  scroll-margin-top: 100px;
}
.oc-step-highlight {
  border-color: rgba(14, 165, 233, 0.4);
  background: linear-gradient(180deg, rgba(14,165,233,0.06), var(--oc-bg-card) 60%);
}
.oc-step-head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.oc-step-num {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--oc-bg-elevated);
  border: 1px solid var(--oc-border-strong);
  color: var(--teal-dark);
  font-weight: 700;
  font-size: 15px;
  font-family: var(--font-mono), monospace;
}
.oc-step-highlight .oc-step-num {
  background: var(--teal);
  border-color: var(--teal);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.25);
}
.oc-step-head h2 {
  font-size: 21px;
  margin: 0 0 6px;
  line-height: 1.25;
  color: var(--text);
}
.oc-step-sub {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.55;
}
.oc-step-body { font-size: 15px; line-height: 1.65; color: var(--text-secondary); }
.oc-step-body p { margin: 12px 0; }
.oc-step-body strong { color: var(--text); }
.oc-step-body code {
  font-family: var(--font-mono), monospace;
  font-size: 13px;
  background: var(--oc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--teal-dark);
}

/* ── Install card grid (step 1) ── */
.oc-install-grid {
  display: flex;
  gap: 10px;
  margin: 14px 0 6px;
  flex-wrap: wrap;
}
.oc-install-card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--oc-border);
  background: var(--oc-bg-elevated);
  border-radius: 8px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s;
}
.oc-install-card:hover {
  border-color: var(--teal);
  transform: translateY(-1px);
}
.oc-install-card span {
  font-weight: 600;
  font-size: 13px;
}
.oc-install-card small {
  color: var(--text-muted);
  font-size: 11px;
}

/* ── Lists ── */
.oc-list {
  margin: 12px 0;
  padding-left: 22px;
}
.oc-list li {
  margin-bottom: 8px;
  line-height: 1.6;
}
.oc-link {
  color: var(--teal);
  text-decoration: underline;
  text-decoration-color: var(--oc-border-strong);
  text-underline-offset: 3px;
}
.oc-link:hover { text-decoration-color: var(--teal); }
.oc-note {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 14px 0 0;
  line-height: 1.6;
}
.oc-note-muted { color: var(--text-muted); font-size: 13px; }

.oc-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  vertical-align: middle;
}
.oc-dot-online {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}

/* ── Code blocks ── */
.oc-code {
  background: #1e1e2e !important;
  border: 1px solid #2a2a3e !important;
  border-radius: 10px;
  padding: 16px 18px;
  font-family: var(--font-mono), monospace;
  font-size: 13px;
  line-height: 1.7;
  color: #e0e0e0 !important;
  overflow-x: auto;
  margin: 14px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.oc-code code { background: none !important; padding: 0; color: inherit !important; font-size: inherit; }

/* ── Generic section ── */
.oc-section {
  margin-top: 16px;
  margin-bottom: 8px;
}
.oc-section h2 {
  font-size: 24px;
  font-weight: 700;
  margin: 0 0 12px;
  color: var(--text);
}
.oc-section p {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text-secondary);
  margin: 12px 0;
}
.oc-section code {
  font-family: var(--font-mono), monospace;
  font-size: 13px;
  background: var(--oc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--teal-light);
}
.oc-section .oc-list { color: var(--text-secondary); }

/* ── Provider table ── */
.oc-table {
  border: 1px solid var(--oc-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--oc-bg-card);
  margin: 16px 0;
}
.oc-table-head,
.oc-table-row {
  display: grid;
  grid-template-columns: 1.2fr 1.4fr 2fr;
  gap: 12px;
  padding: 12px 16px;
  font-size: 13px;
  align-items: center;
}
.oc-table-head {
  background: var(--oc-bg-elevated);
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.06em;
}
.oc-table-row {
  border-top: 1px solid var(--oc-border);
  color: var(--text-secondary);
}
.oc-table-row code {
  font-family: var(--font-mono), monospace;
  color: var(--teal-light);
  background: var(--oc-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  width: fit-content;
}
.oc-table-models { font-size: 13px; }

/* ── Closing ── */
.oc-closing {
  margin-top: 12px;
  padding: 36px 32px;
  border: 1px solid var(--oc-border);
  border-radius: 16px;
  background: radial-gradient(circle at top right, rgba(2, 132, 199, 0.06), transparent 60%), var(--oc-bg-card);
  text-align: center;
}
.oc-closing h2 {
  font-size: 26px;
  margin: 0 0 10px;
  color: var(--text);
}
.oc-closing p {
  color: var(--text-secondary);
  font-size: 15px;
  margin: 0 auto 22px;
  max-width: 460px;
  line-height: 1.6;
}
.oc-closing .oc-cta-row { justify-content: center; }

/* ── Responsive ── */
@media (max-width: 720px) {
  .oc-container { padding-top: 100px; padding-bottom: 64px; }
  .oc-hero h1 { font-size: 32px; }
  .oc-lede { font-size: 16px; }
  .oc-overview-grid,
  .oc-install-grid { grid-template-columns: 1fr; }
  .oc-step { padding: 22px 20px; }
  .oc-step-head h2 { font-size: 19px; }
  .oc-table-head,
  .oc-table-row { grid-template-columns: 1fr; gap: 4px; }
  .oc-table-head { display: none; }
  .oc-table-row { padding: 14px 16px; }
  .oc-closing { padding: 28px 22px; }
}
`;
