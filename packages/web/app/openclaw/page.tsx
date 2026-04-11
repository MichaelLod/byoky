import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Run OpenClaw with Byoky — free, no API credits required',
  description:
    'Use OpenClaw — the open-source AI agent CLI — with Claude, GPT, Gemini and 12 more providers. Pair it with a free Byoky token gift or your existing Claude Pro/Max subscription and run frontier models at zero extra cost.',
  alternates: {
    canonical: '/openclaw',
  },
  openGraph: {
    title: 'Run OpenClaw with Byoky — free, no API credits required',
    description:
      'Use OpenClaw with Claude, GPT, and Gemini for free. Grab a token gift from the Byoky marketplace, or sign in with your Claude Pro/Max subscription. Up in 5 minutes.',
    url: 'https://byoky.com/openclaw',
    type: 'article',
    images: [
      {
        url: '/openclaw-og.png',
        width: 1200,
        height: 630,
        alt: 'OpenClaw',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Run OpenClaw with Byoky — free, no API credits required',
    description:
      'Use OpenClaw with Claude, GPT, and Gemini for free. Grab a token gift from the marketplace, or sign in with your Claude Pro/Max subscription.',
    images: ['/openclaw-og.png'],
  },
};

export default function OpenClawTutorial() {
  return (
    <div className="oc-page">
      <div className="container oc-container">
        <Hero />
        <FreeCallout />
        <Overview />
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
              <span>Chrome</span>
              <small>chromewebstore</small>
            </a>
            <a
              className="oc-install-card"
              href="https://addons.mozilla.org/en-US/firefox/addon/byoky/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Firefox</span>
              <small>addons.mozilla.org</small>
            </a>
            <a
              className="oc-install-card"
              href="https://apps.apple.com/app/byoky/id6760779919"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>iOS / Safari</span>
              <small>App Store</small>
            </a>
            <a
              className="oc-install-card"
              href="https://play.google.com/store/apps/details?id=com.byoky.app"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>Android</span>
              <small>Play Store</small>
            </a>
          </div>
          <p className="oc-note">
            Open the wallet, set a password, and you&apos;re ready. No accounts, no email.
          </p>
        </Step>

        <Step
          n={2}
          title="Grab a free token gift"
          subtitle="Don't have an API key yet? Don't need one. The community shares free token gifts on the Byoky marketplace."
          highlight
        >
          <ol className="oc-list">
            <li>
              Open the{' '}
              <a className="oc-link" href="/marketplace">
                Token Marketplace
              </a>
              .
            </li>
            <li>
              Find a gift with the provider you want — look for the{' '}
              <span className="oc-dot oc-dot-online" /> green dot (gifter is
              online) and tokens remaining.
            </li>
            <li>Click <strong>Redeem</strong> and copy the gift link.</li>
            <li>
              Open your Byoky wallet → <strong>Gifts</strong> →{' '}
              <strong>Redeem Gift</strong> → paste the link → accept.
            </li>
          </ol>
          <p className="oc-note">
            That&apos;s it. Your wallet now has a credential backed by someone
            else&apos;s API key — capped to a token budget the gifter set. The
            real key never reaches you, and OpenClaw never sees it either.
          </p>
          <p className="oc-note oc-note-muted">
            Already have your own API key? Skip the marketplace and add the
            credential directly in the wallet.
          </p>

          <div className="oc-sub-card">
            <div className="oc-sub-card-head">
              Or: connect your Claude Pro/Max subscription
            </div>
            <p>
              If you already pay for Claude Pro or Max, you can use those
              subscription credits inside OpenClaw — no API key, no extra
              spend. In the wallet, add an Anthropic credential and choose{' '}
              <strong>Setup Token</strong>:
            </p>
            <Code>{`claude setup-token`}</Code>
            <p>
              That command (from the Claude Code CLI) prints a token starting
              with <code>sk-ant-oat01-...</code>. Paste it into Byoky and the
              wallet routes OpenClaw&apos;s requests through your{' '}
              <code>claude.ai</code> subscription instead of the API.
            </p>
            <p className="oc-note oc-note-muted">
              Setup-token requests route through the Byoky bridge (next step),
              so the bridge install is required for this path.
            </p>
          </div>
        </Step>

        <Step
          n={3}
          title="Install the Byoky bridge"
          subtitle="The bridge is a tiny local HTTP proxy. OpenClaw talks to it instead of the LLM provider directly."
        >
          <Code>
            {`npm install -g @byoky/bridge
byoky-bridge install`}
          </Code>
          <p className="oc-note">
            <code>byoky-bridge install</code> registers the native messaging
            host so the bridge can hand requests off to your extension. You only
            run this once.
          </p>
        </Step>

        <Step
          n={4}
          title="Install the OpenClaw plugin"
          subtitle="One npm package adds all 15 Byoky providers to OpenClaw."
        >
          <Code>{`npm install -g @byoky/openclaw-plugin`}</Code>
        </Step>

        <Step
          n={5}
          title="Connect OpenClaw to your wallet"
          subtitle="Pick a provider and log in. OpenClaw will open your browser so the wallet can approve the connection."
        >
          <Code>{`openclaw models auth login --provider byoky-anthropic`}</Code>
          <p>
            Unlock your wallet, approve the request, and the bridge starts
            automatically. Verify it&apos;s running:
          </p>
          <Code>
            {`curl http://127.0.0.1:19280/health
# → {"status":"ok","providers":["anthropic"]}`}
          </Code>
          <p className="oc-note">
            Want a different provider? Re-run the command with another id —{' '}
            <code>byoky-openai</code>, <code>byoky-gemini</code>,{' '}
            <code>byoky-xai</code>, etc.
          </p>
        </Step>

        <Step
          n={6}
          title="Use OpenClaw"
          subtitle="That's the whole setup. Run OpenClaw as you normally would — every LLM call routes through your wallet."
        >
          <p>
            Inside OpenClaw, the <code>/byoky</code> command shows the bridge
            status and which providers are connected:
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
  return (
    <header className="oc-hero">
      <div className="oc-eyebrow">OpenClaw × Byoky</div>
      <h1>
        Run <span className="oc-grad">Claude, GPT, and Gemini</span> in
        OpenClaw.<br />
        <span className="oc-hero-sub-line">No API credits required.</span>
      </h1>
      <p className="oc-lede">
        OpenClaw is an open-source AI agent CLI. Byoky is a key wallet that
        proxies LLM calls so the API key never leaves the device. Pair them
        with a free token gift from the marketplace — or sign in with your
        existing Claude Pro/Max subscription — and OpenClaw runs frontier
        models at zero extra cost.
      </p>
      <div className="oc-cta-row">
        <a className="btn btn-primary" href="/marketplace">
          Browse free gifts
        </a>
        <a
          className="btn btn-secondary"
          href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
          target="_blank"
          rel="noopener noreferrer"
        >
          Install Byoky wallet
        </a>
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
          <h3>Token gift from the marketplace</h3>
          <p>
            Anyone can gift token access on the{' '}
            <a className="oc-link" href="/marketplace">
              Byoky marketplace
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
          <p>Redeem a gift from the marketplace, or use your own key.</p>
        </div>
        <div className="oc-overview-card">
          <span className="oc-overview-num">3</span>
          <h3>Install bridge + plugin</h3>
          <p>Two npm installs — the bridge and the OpenClaw plugin.</p>
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
  const rows: [string, string, string][] = [
    ['Anthropic', 'byoky-anthropic', 'Claude Opus 4, Sonnet 4, Haiku 4.5'],
    ['OpenAI', 'byoky-openai', 'GPT-4.1, o3, o4-mini, GPT-4.1 Mini'],
    ['Google Gemini', 'byoky-gemini', 'Gemini 2.5 Pro, 2.5 Flash'],
    ['xAI', 'byoky-xai', 'Grok 3, Grok 3 Mini'],
    ['DeepSeek', 'byoky-deepseek', 'DeepSeek V3, R1'],
    ['Mistral', 'byoky-mistral', 'Mistral Large'],
    ['Groq', 'byoky-groq', 'Llama 3.3 70B'],
    ['Cohere', 'byoky-cohere', 'Set model manually'],
    ['Perplexity', 'byoky-perplexity', 'Set model manually'],
    ['Together AI', 'byoky-together', 'Set model manually'],
    ['Fireworks AI', 'byoky-fireworks', 'Set model manually'],
    ['OpenRouter', 'byoky-openrouter', 'Set model manually'],
    ['Azure OpenAI', 'byoky-azure_openai', 'Set model manually'],
  ];
  return (
    <section className="oc-section">
      <h2>Available providers</h2>
      <p>The plugin registers all 15 Byoky providers with OpenClaw:</p>
      <div className="oc-table">
        <div className="oc-table-head">
          <span>Provider</span>
          <span>OpenClaw ID</span>
          <span>Models</span>
        </div>
        {rows.map(([name, id, models]) => (
          <div className="oc-table-row" key={id}>
            <span>{name}</span>
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
        Grab a free token gift from the marketplace and you&apos;ll be running
        Claude or GPT inside OpenClaw in under five minutes.
      </p>
      <div className="oc-cta-row">
        <a className="btn btn-primary" href="/marketplace">
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
    <section className={`oc-step ${highlight ? 'oc-step-highlight' : ''}`}>
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
  --oc-bg-card: #0d0d1a;
  --oc-bg-elevated: #14142a;
  --oc-border: #1a1a34;
  --oc-border-strong: #2a2a50;
  color: var(--text);
}

.oc-container {
  max-width: 820px;
  padding-top: 120px;
  padding-bottom: 96px;
}

/* ── Hero ── */
.oc-hero { margin-bottom: 56px; }
.oc-eyebrow {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--teal);
  background: rgba(14, 165, 233, 0.08);
  border: 1px solid rgba(14, 165, 233, 0.25);
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
  margin-bottom: 48px;
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
  color: var(--teal-light);
  font-weight: 700;
  font-size: 15px;
  font-family: var(--font-mono), monospace;
}
.oc-step-highlight .oc-step-num {
  background: var(--teal);
  border-color: var(--teal);
  color: #001018;
  box-shadow: 0 0 24px rgba(14, 165, 233, 0.35);
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
  color: var(--teal-light);
}

/* ── Install card grid (step 1) ── */
.oc-install-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 14px 0 6px;
}
.oc-install-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--oc-border);
  background: var(--oc-bg-elevated);
  border-radius: 10px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.15s, transform 0.15s;
}
.oc-install-card:hover {
  border-color: var(--teal);
  transform: translateY(-1px);
}
.oc-install-card span {
  font-weight: 600;
  font-size: 14px;
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
  color: var(--teal-light);
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
  background: #07070f;
  border: 1px solid var(--oc-border);
  border-radius: 10px;
  padding: 16px 18px;
  font-family: var(--font-mono), monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
  overflow-x: auto;
  margin: 14px 0;
}
.oc-code code { background: none; padding: 0; color: inherit; font-size: inherit; }

/* ── Generic section ── */
.oc-section {
  margin-top: 64px;
  margin-bottom: 24px;
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
  margin-top: 72px;
  padding: 36px 32px;
  border: 1px solid var(--oc-border);
  border-radius: 16px;
  background: radial-gradient(circle at top right, rgba(14,165,233,0.12), transparent 60%), var(--oc-bg-card);
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
