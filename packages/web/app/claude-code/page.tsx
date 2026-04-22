import type { Metadata } from 'next';
import { InstallWithAI } from './InstallWithAI';

export const metadata: Metadata = {
  title: 'Run Claude Code with Byoky — free, on your existing Claude Pro/Max plan',
  description:
    'Use Claude Code — Anthropic’s official CLI — with a free Byoky token gift or your existing Claude Pro/Max subscription. Zero API credits, keys never leave your machine.',
  alternates: {
    canonical: '/claude-code',
  },
  openGraph: {
    title: 'Run Claude Code with Byoky — free, on your existing Claude Pro/Max plan',
    description:
      'Point Claude Code at the Byoky bridge and run it on a gifted credential or your Claude Pro/Max subscription. Up in 5 minutes.',
    url: 'https://byoky.com/claude-code',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Run Claude Code with Byoky — free, on your existing Claude Pro/Max plan',
    description:
      'Point Claude Code at the Byoky bridge and run it on a gifted credential or your Claude Pro/Max subscription.',
  },
};

export default function ClaudeCodeTutorial() {
  return (
    <div className="oc-page">
      <div className="container oc-container">
        <Hero />
        <VersionHint />
        <FreeCallout />

        <Step
          n={1}
          title="Install the Byoky wallet"
          subtitle="The wallet holds the Anthropic credential (yours, gifted, or a Claude Pro/Max setup token) and proxies every request. Claude Code runs on your desktop, so the wallet needs to live in a desktop browser on the same machine."
        >
          <p>Pick your browser:</p>
          <div className="oc-install-grid">
            <a
              className="oc-install-card"
              href="https://github.com/MichaelLod/byoky/releases/download/v0.9.1/byoky-chrome-v0.9.1.zip"
            >
              <svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>
              <span>Chrome — v0.9.1 unpacked</span>
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
          </div>
          <p className="oc-note">
            <strong>Version 0.9.1+ is required</strong> for Claude Code. The
            Chrome Web Store is still serving 0.7.4 — download the unpacked
            zip above and load it via <code>chrome://extensions</code> →{' '}
            enable Developer mode → &quot;Load unpacked&quot; on the extracted
            folder. Firefox is already on the required version.
          </p>
          <p className="oc-note oc-note-muted">
            iOS and Android wallets exist but can&apos;t host Claude Code —
            the <code>claude</code> CLI and the Byoky Bridge need a desktop
            OS. (The mobile wallets are for gift senders or browsing the
            token pool on the go.)
          </p>
        </Step>

        <Step
          n={2}
          title="Add an Anthropic credential"
          subtitle="Three options — pick whichever fits."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="oc-option-card">
              <strong>Free token gift</strong> — grab one from the{' '}
              <a className="oc-link" href="/token-pool">Token Pool</a>. Filter
              for Anthropic. The gifter&apos;s key runs the calls; you just
              burn their budget.
            </div>
            <div className="oc-option-card">
              <strong>Claude Pro/Max setup token</strong> — run{' '}
              <code>claude setup-token</code> in your terminal and paste the
              result into Byoky. Claude Code runs on your existing plan, no
              API credits needed.
            </div>
            <div className="oc-option-card">
              <strong>Your own API key</strong> — add an Anthropic API key
              directly. Only do this if you already pay for the API tier
              (otherwise Claude Code won&apos;t classify as first-party and
              will fail with a billing error).
            </div>
          </div>
        </Step>

        <Step
          n={3}
          title="Install Claude Code and the Byoky Bridge"
          subtitle="Claude Code is Anthropic's CLI. The Bridge is the tiny local proxy that sits between Claude Code and your wallet."
        >
          <Code>{`npm install -g @anthropic-ai/claude-code
npm install -g @byoky/bridge
byoky-bridge install`}</Code>
          <p className="oc-note">
            <code>byoky-bridge install</code> writes a native messaging host
            manifest that whitelists the Byoky extension. Restart your browser
            once so Chrome picks up the manifest. You only ever do this once
            per machine.
          </p>
          <InstallWithAI />
        </Step>

        <Step
          n={4}
          title="Connect the wallet"
          subtitle="One command that opens the browser, approves a session, and starts the bridge proxy on :19280."
        >
          <Code>{`byoky-bridge connect`}</Code>
          <p>
            A browser tab opens on <code>http://127.0.0.1:&lt;ephemeral&gt;</code>.
            Click <strong>Connect wallet</strong>, approve the session in the
            Byoky popup, and the tab reports success. The bridge is now
            listening on <code>127.0.0.1:19280</code> and stays up as long as
            your browser is running. Re-run the command after a browser restart.
          </p>
          <p>Verify it:</p>
          <Code>
            {`curl http://127.0.0.1:19280/health
# → {"status":"ok","providers":["anthropic",...]}`}
          </Code>
          <p className="oc-note oc-note-muted">
            If <code>anthropic</code> is missing, the wallet doesn&apos;t have
            an Anthropic credential loaded yet — go back to step 2.
          </p>
        </Step>

        <Step
          n={5}
          title="Point Claude Code at the bridge and run"
          subtitle="Two env vars and you're done."
        >
          <Code>{`export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
export ANTHROPIC_AUTH_TOKEN=byoky
claude`}</Code>
          <p>
            Add the two <code>export</code> lines to <code>~/.zshrc</code> or{' '}
            <code>~/.bashrc</code> so new terminals pick them up. The token
            value doesn&apos;t matter — the bridge strips the{' '}
            <code>Authorization</code> header and injects the real credential
            from your wallet. Token usage shows up in the wallet&apos;s{' '}
            <strong>Sessions</strong> view. If you&apos;re using a gifted
            credential, the gifter&apos;s budget ticks down in real time and
            the session stops cleanly when it hits zero.
          </p>
          <p className="oc-note oc-note-muted">
            Pro tip: run <code>claude --model claude-sonnet-4-5</code> (or
            whichever model the gifter&apos;s plan covers) if you hit a model
            access error.
          </p>
        </Step>

        <Troubleshooting />
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
      <div className="oc-eyebrow">Claude Code × Byoky</div>
      <h1>Run Claude Code — on your Pro/Max plan or a free gift.</h1>
      <div style={{
        display: 'flex', gap: '16px', justifyContent: 'center',
        flexWrap: 'wrap', margin: '24px 0',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '15px', fontWeight: 600, color: 'var(--text)',
        }}>
          <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg" alt="" width={22} height={22} />
          Claude Code
        </div>
      </div>
      <p className="oc-lede">
        Point Anthropic&apos;s official CLI at the Byoky bridge.<br />
        Zero API credits. Keys stay in your wallet.
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

function VersionHint() {
  return (
    <div className="oc-version-hint" role="note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>
        Requires Byoky extension <strong>v0.9.1+</strong> and{' '}
        <code>@byoky/bridge@0.9.3+</code> (for <code>byoky-bridge connect</code>).
        Firefox is live on AMO; Chrome Web Store is still on 0.7.4 in review, so{' '}
        <a
          className="oc-link"
          href="https://github.com/MichaelLod/byoky/releases/download/v0.9.1/byoky-chrome-v0.9.1.zip"
        >load the v0.9.1 unpacked build</a> for now.
      </span>
    </div>
  );
}

function FreeCallout() {
  return (
    <div className="oc-paths">
      <div className="oc-paths-heading">Two ways to run Claude Code for free</div>
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
            Anyone can gift Anthropic token access on the{' '}
            <a className="oc-link" href="/token-pool">Byoky token pool</a>.
            Claude Code runs entirely on the gifter&apos;s budget — capped,
            revocable, and proxied through their wallet so their key never
            leaves their machine.
          </p>
          <p className="oc-path-tag">No card, no signup, no Anthropic account.</p>
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
            setup token and Claude Code runs on the same subscription credits
            you already use in <code>claude.ai</code>. <strong>No API
            credits, no per-token billing.</strong>
          </p>
          <p className="oc-path-tag">Uses your existing plan.</p>
        </div>
      </div>
    </div>
  );
}

function Troubleshooting() {
  const items: [string, React.ReactNode][] = [
    [
      '"Third-party apps now draw from your extra usage..."',
      <>
        Anthropic classified your request as non-Claude-Code. Almost always
        this means the wallet is using an <strong>API key</strong> instead of
        an <strong>OAuth setup token</strong>. Run{' '}
        <code>claude setup-token</code> in your terminal, paste the result
        into the wallet as a fresh Anthropic credential, and retry. Gifted
        Anthropic credentials already handle the classification on the
        gifter&apos;s side.
      </>,
    ],
    [
      'ECONNREFUSED 127.0.0.1:19280',
      <>
        The bridge proxy isn&apos;t listening yet. Run{' '}
        <code>byoky-bridge connect</code> — it opens a tab, waits for you to
        approve the session in the wallet, and starts the proxy on :19280.
        After a browser restart the proxy stops (the extension&apos;s service
        worker holds it open), so re-run the command to bring it back.
      </>,
    ],
    [
      '"invalid x-api-key" or "Invalid bearer token"',
      <>
        The key stored in your wallet is wrong or revoked. Grab a fresh one
        from <code>console.anthropic.com</code>, re-run{' '}
        <code>claude setup-token</code>, or use a free gift from the{' '}
        <a className="oc-link" href="/token-pool">token pool</a>.
      </>,
    ],
    [
      'Anthropic keeps returning 429 rate_limit_error on a gift',
      <>
        The gifter&apos;s upstream key is being throttled (the limit is on
        their account, not yours). Try a different Anthropic gift, or wait
        for the window to clear (usually 1 hour).
      </>,
    ],
    [
      '"provider not available in this session" after I added the key',
      <>
        The bridge snapshotted your providers before you added the Anthropic
        credential. Open the wallet popup, end the current session, and
        re-run <code>claude</code> — it will request a new session with the
        updated provider list.
      </>,
    ],
    [
      'The bridge works but Chrome won’t talk to it on my unpacked build',
      <>
        Bridge 0.9.2+ whitelists both the Web Store extension ID and the
        pinned unpacked ID (0.9.1 shipped with the wrong unpacked ID).
        Upgrade with{' '}
        <code>npm i -g @byoky/bridge@latest &amp;&amp; byoky-bridge install</code>,
        restart the browser, and reload the unpacked extension.
      </>,
    ],
  ];
  return (
    <section className="oc-section">
      <h2>If something doesn&apos;t work</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {items.map(([q, a], i) => (
          <div className="oc-option-card" key={i}>
            <strong>{q}</strong>
            <p style={{ margin: '6px 0 0', fontSize: '14px', lineHeight: 1.55 }}>{a}</p>
          </div>
        ))}
      </div>
      <p className="oc-note oc-note-muted">
        The bridge logs to stderr — tail it with{' '}
        <code>tail -f ~/Library/Logs/byoky-bridge.log</code> (macOS) if you
        need to see raw request errors. For a deep dive on why some
        configurations classify as third-party, see{' '}
        <a className="oc-link" href="/blog/anthropic-claude-code-fingerprint">
          Bisecting Anthropic&apos;s Claude Code fingerprint
        </a>.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="oc-section">
      <h2>How it works</h2>
      <Code>
        {`claude → HTTP → Bridge (localhost:19280/anthropic) → Extension → api.anthropic.com
                                                       ↑
                                              Keys live here. Always.`}
      </Code>
      <ol className="oc-list">
        <li>
          Claude Code CLI sends requests to{' '}
          <code>$ANTHROPIC_BASE_URL</code> — pointed at{' '}
          <code>http://127.0.0.1:19280/anthropic</code>.
        </li>
        <li>
          The bridge strips the placeholder <code>Authorization</code> header
          and forwards the request to your Byoky extension via native
          messaging.
        </li>
        <li>
          The extension injects the real Anthropic credential (your own API
          key, your OAuth setup token, or a gifted credential routed through
          the gifter&apos;s extension) and makes the call.
        </li>
        <li>
          The streaming response flows back through the same path —
          Claude Code sees plain SSE, exactly as if it talked to{' '}
          <code>api.anthropic.com</code> directly.
        </li>
      </ol>
      <p>
        For OAuth credentials (Pro/Max setup tokens), the extension routes
        outbound calls through the bridge a second time so the request is
        made from Node instead of Chrome. That bypasses the TLS fingerprint
        Anthropic uses to classify Claude Code vs. third-party apps — see{' '}
        <a className="oc-link" href="/blog/anthropic-claude-code-fingerprint">
          the fingerprint post
        </a>{' '}
        for the full story.
      </p>
    </section>
  );
}

function Closing() {
  return (
    <section className="oc-closing">
      <h2>Ready to try it?</h2>
      <p>
        Grab a free Anthropic token gift from the token pool and you&apos;ll
        be running Claude Code on it in under five minutes.
      </p>
      <div className="oc-cta-row">
        <a className="btn btn-primary" href="/token-pool">
          Browse free gifts
        </a>
        <a
          className="btn btn-secondary"
          href="https://github.com/MichaelLod/byoky/tree/main/packages/bridge"
          target="_blank"
          rel="noopener noreferrer"
        >
          Bridge on GitHub
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

/* Hero */
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
.oc-lede {
  font-size: 17px;
  line-height: 1.65;
  color: var(--text-secondary);
  max-width: 680px;
  margin: 0 0 28px;
}
.oc-cta-row { display: flex; gap: 12px; flex-wrap: wrap; }

/* Version hint */
.oc-version-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: -32px auto 40px;
  max-width: 680px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(234, 179, 8, 0.08);
  border: 1px solid rgba(234, 179, 8, 0.3);
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-secondary);
}
.oc-version-hint svg {
  flex-shrink: 0;
  margin-top: 2px;
  color: #b45309;
}
.oc-version-hint strong { color: var(--text); }
.oc-version-hint code {
  font-family: var(--font-mono), monospace;
  font-size: 12.5px;
  background: rgba(234, 179, 8, 0.14);
  padding: 1px 5px;
  border-radius: 3px;
}

/* Two free paths */
.oc-paths { margin-bottom: 64px; }
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

/* Sub-card (alternative inside a step) */
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

/* Steps */
.oc-step {
  margin-bottom: 12px;
  padding: 28px 28px 24px;
  border: 1px solid var(--oc-border);
  border-radius: 16px;
  background: var(--oc-bg-card);
  scroll-margin-top: 100px;
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

/* Install card grid (step 1) */
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

/* Lists */
.oc-list { margin: 12px 0; padding-left: 22px; }
.oc-list li { margin-bottom: 8px; line-height: 1.6; }
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

/* Code blocks */
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

/* Generic section */
.oc-section { margin-top: 16px; margin-bottom: 8px; }
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

/* Closing */
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

/* Responsive */
@media (max-width: 720px) {
  .oc-container { padding-top: 100px; padding-bottom: 64px; }
  .oc-hero h1 { font-size: 32px; }
  .oc-lede { font-size: 16px; }
  .oc-install-grid { flex-direction: column; }
  .oc-paths-grid { grid-template-columns: 1fr; }
  .oc-step { padding: 22px 20px; }
  .oc-step-head h2 { font-size: 19px; }
  .oc-closing { padding: 28px 22px; }
}
`;
