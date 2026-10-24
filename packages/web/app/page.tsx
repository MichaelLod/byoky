import { FadeIn } from './components/FadeIn';
import { VersionStatus } from './components/VersionStatus';
import { ProviderMarquee } from './components/ProviderMarquee';
import { GitHubStarButton } from './components/GitHubStarButton';
import { ExtensionMock } from './components/ExtensionMock';
import { AppsShowcase } from './components/AppsShowcase';
import { InstallWalletButton } from './components/InstallWalletButton';
import { HeroRollout } from './components/HeroRollout';

export default function Home() {
  return (
    <>
      <Hero />
      <div className="divider" />
      <HowItWorks />
      <Providers />
      <div className="divider" />
      <AppsShowcase />
      <div className="divider" />
      <WhyAWallet />
      <div className="divider" />
      <NoServers />
      <div className="divider" />
      <WhereAppsConnect />
      <div className="divider" />
      <OpenClawCTA />
      <div className="divider" />
      <ForDevelopers />
      <div className="divider" />
      <Security />
      <div className="divider" />
      <ClosingStrip />
      <Footer />
    </>
  );
}

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden />
      <div className="hero-glow-secondary" aria-hidden />
      <div className="hero-glow-tertiary" aria-hidden />
      <div className="container">
        <FadeIn>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Open source · No servers · No accounts
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1>
            <span className="hero-eyebrow">The MetaMask</span>
            <span className="hero-gradient">for API keys.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            Keep every AI API key in one wallet. Apps connect to the wallet,
            the wallet makes their calls, and your keys never leave Byoky.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="hero-actions">
            <InstallWalletButton className="btn btn-primary">
              <DownloadIcon />
              Install Wallet
            </InstallWalletButton>
            <a
              href="/docs"
              className="btn btn-secondary"
            >
              Start Building
            </a>
          </div>
          <div className="hero-also">
            Also on{' '}
            <a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" target="_blank" rel="noopener noreferrer">Firefox</a>
            {' · '}
            <a href="https://apps.apple.com/app/byoky/id6760779919" target="_blank" rel="noopener noreferrer">iOS</a>
            {' · '}
            <a href="https://play.google.com/store/apps/details?id=com.byoky.app" target="_blank" rel="noopener noreferrer">Android</a>
            {' · '}
            <a href="https://github.com/MichaelLod/byoky" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>
          <HeroRollout />
        </FadeIn>
        <FadeIn delay={0.35}>
          <div className="hero-trust-bar">
            <div className="hero-trust-item">
              <LinkIcon />
              <span>13 Providers</span>
            </div>
            <div className="hero-trust-item">
              <CloudOffIcon />
              <span>No Servers, No Accounts</span>
            </div>
            <div className="hero-trust-item">
              <LockIcon />
              <span>AES-256-GCM Encrypted</span>
            </div>
            <div className="hero-trust-item">
              <ShieldIcon />
              <span>MIT Licensed</span>
            </div>
          </div>
        </FadeIn>
        <FadeIn delay={0.4}>
          <VersionStatus />
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── How it Works ─────────────────────────────── */

function HowItWorks() {
  return (
    <section className="steps-section">
      <div className="container">
        <FadeIn>
          <h2>Add your keys once. Every app connects.</h2>
          <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M24 8a16 16 0 0 1 13.86 8H24v0z" fill="#EA4335"/><path d="M37.86 16A16 16 0 0 1 24 40l6.93-12z" fill="#FBBC05"/><path d="M24 40A16 16 0 0 1 10.14 16l6.93 12z" fill="#34A853"/><path d="M10.14 16A16 16 0 0 1 24 8v8z" fill="#4285F4"/><circle cx="24" cy="24" r="6" fill="#fff"/><circle cx="24" cy="24" r="4" fill="#4285F4"/></svg>
              Chrome
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#fff" stroke="#ddd" strokeWidth="1"/><path d="M38 18c-1-4-4-7-8-9 2 2 3 5 3 7 0 3-2 6-5 7-4 1-7-1-7-1s1 5 6 6c4 1 8-1 10-4 1-1 1-3 1-6z" fill="#FF4F00"/><path d="M14 30c-1-3 0-6 2-9 1-2 3-3 5-4-2 2-3 4-2 7 0 2 2 4 4 5 3 1 6 0 7-2-1 3-4 6-8 6-3 1-6-1-8-3z" fill="#FF9500"/></svg>
              Firefox
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#999"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              iOS &amp; Safari
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#3DDC84"><path d="M17.523 15.341a.91.91 0 0 0 .916-.907V9.478a.91.91 0 0 0-.916-.907.91.91 0 0 0-.917.907v4.956a.91.91 0 0 0 .917.907zm-11.046 0a.91.91 0 0 0 .917-.907V9.478a.91.91 0 0 0-.917-.907.91.91 0 0 0-.916.907v4.956a.91.91 0 0 0 .916.907zm1.48 5.178c0 .504.41.912.916.912h.95v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h1.688v2.66a.91.91 0 0 0 .916.909.91.91 0 0 0 .917-.908v-2.66h.95a.914.914 0 0 0 .916-.913V8.879H7.957v11.64zM15.4 3.11l1.124-1.727a.235.235 0 0 0-.073-.324.237.237 0 0 0-.326.072l-1.14 1.75A6.813 6.813 0 0 0 12 2.321c-1.07 0-2.08.195-3.003.56L7.857 1.13a.236.236 0 0 0-.325-.072.235.235 0 0 0-.073.324L8.583 3.11C6.572 4.12 5.204 6.071 5.204 8.338h13.592c0-2.267-1.368-4.219-3.396-5.228z"/></svg>
              Android
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 500 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              CLI
            </div>
          </div>
        </FadeIn>
        <div className="steps-grid">
          <FadeIn delay={0.1}>
            <div className="step">
              <div className="step-number">
                <WalletIcon />
              </div>
              <h3>Add your keys once</h3>
              <p>
                Install the wallet, set a master password, and add your API
                keys or a Claude setup token. They&apos;re encrypted on this device.
              </p>
              <div className="step-mock-wrap">
                <ExtensionMock scene="wallet" size="cell" />
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="step">
              <div className="step-number">
                <LinkIcon />
              </div>
              <h3>Apps ask, you approve</h3>
              <p>
                Open any Byoky-enabled app. It asks for access to the providers
                it needs, and you decide.
              </p>
              <div className="step-mock-wrap">
                <ExtensionMock scene="approval" size="cell" />
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="step">
              <div className="step-number">
                <CheckIcon />
              </div>
              <h3>The wallet makes the calls</h3>
              <p>
                Requests go from your wallet straight to the provider. The app
                gets a session token, never your key.
              </p>
              <div className="step-mock-wrap">
                <ExtensionMock scene="connect-chat" size="cell" />
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Providers ────────────────────────────────── */

function Providers() {
  return <ProviderMarquee />;
}

/* ─── Why a wallet ─────────────────────────────── */

function WhyAWallet() {
  return (
    <section className="wallet-section">
      <div className="container">
        <FadeIn>
          <div className="wallet-section-head">
            <h2>Stop pasting keys into apps.</h2>
            <p>
              A key pasted into a settings page is a key you no longer control.
              With Byoky, apps connect to your wallet the way dapps connect to MetaMask.
            </p>
          </div>
        </FadeIn>
        <div className="side-by-side-grid">
          <FadeIn>
            <div className="sbs-card">
              <div className="sbs-badge">Providers</div>
              <div className="sbs-icon-row">
                <KeyIcon />
              </div>
              <h3 className="sbs-title">One wallet, every provider.</h3>
              <p className="sbs-desc">
                Anthropic, OpenAI, Gemini, Mistral and nine more, plus custom
                endpoints. Add a key once and use it in every Byoky-enabled app.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="sbs-card">
              <div className="sbs-badge">Control</div>
              <div className="sbs-icon-row">
                <EyeIcon />
              </div>
              <h3 className="sbs-title">Apps connect instead of copying keys.</h3>
              <p className="sbs-desc">
                Approve an app, see every request it makes, set spending caps,
                and revoke it with one click. No more <code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal-light)', fontSize: 13 }}>sk-...</code> in a settings page.
              </p>
            </div>
          </FadeIn>
          <FadeIn>
            <div className="sbs-card">
              <div className="sbs-badge">Groups</div>
              <div className="sbs-icon-row">
                <LayersIcon />
              </div>
              <h3 className="sbs-title">Switch keys by dragging an app.</h3>
              <p className="sbs-desc">
                Bucket connected apps by purpose (&ldquo;Personal&rdquo;, &ldquo;Work&rdquo;), pin
                each group to a credential, then drag apps between groups to change
                which key they use. Live sessions reroute without code changes.
              </p>
              <div className="openclaw-flow" style={{ marginTop: 16, marginBottom: 0 }}>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Your App</span>
                  <span className="openclaw-flow-sub">connected</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Work</span>
                  <span className="openclaw-flow-sub">group</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Team key</span>
                  <span className="openclaw-flow-sub">credential</span>
                </div>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="sbs-card">
              <div className="sbs-badge">Cross-Provider</div>
              <div className="sbs-icon-row">
                <ShuffleIcon />
              </div>
              <h3 className="sbs-title">One app. Any provider.</h3>
              <p className="sbs-desc">
                Drag an app from a Claude group into a GPT group and the wallet
                translates on the fly: Anthropic ↔ OpenAI ↔ Gemini ↔ Cohere request
                bodies, response bodies and SSE streams.
              </p>
              <div className="openclaw-flow" style={{ marginTop: 16, marginBottom: 0 }}>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Your App</span>
                  <span className="openclaw-flow-sub">Anthropic SDK</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Wallet</span>
                  <span className="openclaw-flow-sub">Translates</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">GPT-4o</span>
                  <span className="openclaw-flow-sub">OpenAI API</span>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
      <style>{`
        .wallet-section-head {
          text-align: center;
          max-width: 640px;
          margin: 0 auto 48px;
        }
        .wallet-section-head h2 {
          font-size: 44px;
          font-weight: 700;
          letter-spacing: -0.03em;
          margin-bottom: 14px;
        }
        .wallet-section-head p {
          font-size: 17px;
          color: var(--text-secondary);
          line-height: 1.6;
        }
        @media (max-width: 720px) {
          .wallet-section-head h2 { font-size: 32px; }
          .wallet-section-head p { font-size: 15px; }
        }
      `}</style>
    </section>
  );
}

/* ─── No servers ───────────────────────────────── */

function NoServers() {
  return (
    <section className="zero-cost-section">
      <div className="zero-cost-glow" aria-hidden />
      <div className="container">
        <FadeIn>
          <h2 className="zero-cost-heading">
            No servers.<br />
            <span className="hero-gradient">No accounts. No cloud.</span>
          </h2>
          <p className="zero-cost-body">
            Byoky doesn&apos;t run anything that sits between you and your provider.
            The wallet talks only to the AI providers you add. There is nothing to
            sign up for and nothing to sync.
          </p>
        </FadeIn>
        <div className="zero-cost-grid">
          <FadeIn delay={0.1}>
            <div className="zero-cost-card">
              <span className="zero-cost-stat">0</span>
              <span className="zero-cost-label">Byoky servers in the request path</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="zero-cost-card">
              <span className="zero-cost-stat">0</span>
              <span className="zero-cost-label">accounts to create</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="zero-cost-card">
              <span className="zero-cost-stat">MIT</span>
              <span className="zero-cost-label">every component open source, mobile apps included</span>
            </div>
          </FadeIn>
        </div>
        <FadeIn delay={0.4}>
          <p className="zero-cost-pitch">
            Your keys are encrypted on your device. Moving them to another device
            is up to you, with an encrypted backup file.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Where apps can connect ───────────────────── */

const connectTargets: Array<{
  badge: string;
  title: string;
  desc: string;
  flow: Array<{ label: string; sub?: string; highlight?: boolean }>;
}> = [
  {
    badge: 'Desktop browser',
    title: 'Chrome and Firefox',
    desc: 'Web apps connect through the Byoky browser extension. Keys live in the extension.',
    flow: [
      { label: 'Web app', sub: 'SDK' },
      { label: 'Extension', sub: 'Keys here', highlight: true },
      { label: 'LLM API' },
    ],
  },
  {
    badge: 'iPhone & iPad',
    title: 'Safari on iOS',
    desc: 'The Byoky Safari extension, included with the iOS app, brings the wallet to Safari. Add your keys in its popup and web apps in Safari connect to it.',
    flow: [
      { label: 'Web app', sub: 'Safari' },
      { label: 'Safari ext.', sub: 'Keys here', highlight: true },
      { label: 'LLM API' },
    ],
  },
  {
    badge: 'In-wallet browser',
    title: 'Any web app on iOS and Android',
    desc: 'Open any https app by URL in the built-in browser of the iOS or Android app. It connects through an injected wallet bridge, no extension needed.',
    flow: [
      { label: 'Web app', sub: 'in-wallet' },
      { label: 'Mobile app', sub: 'Keys here', highlight: true },
      { label: 'LLM API' },
    ],
  },
  {
    badge: 'CLI & desktop',
    title: 'Terminal tools and agents',
    desc: '@byoky/bridge is a localhost proxy that hands requests to the extension over native messaging. Works with OpenClaw, Claude Code and Hermes.',
    flow: [
      { label: 'CLI', sub: 'HTTP' },
      { label: 'Bridge', sub: 'localhost' },
      { label: 'Extension', sub: 'Keys here', highlight: true },
    ],
  },
  {
    badge: 'Your backend',
    title: 'Server-side LLM calls',
    desc: 'Your server makes calls through the user’s browser over a WebSocket you host. Your backend never sees the key, and no Byoky server is involved.',
    flow: [
      { label: 'Backend', sub: 'your WS' },
      { label: 'Browser', sub: 'SDK' },
      { label: 'Extension', sub: 'Keys here', highlight: true },
    ],
  },
  {
    badge: 'Between devices',
    title: 'No sync. Bring your backup.',
    desc: 'Wallets don\u2019t pair or sync. To use your keys on another device, export a password-protected .byoky backup and import it there.',
    flow: [
      { label: 'Wallet', sub: 'device A' },
      { label: '.byoky file', sub: 'encrypted', highlight: true },
      { label: 'Wallet', sub: 'device B' },
    ],
  },
];

function WhereAppsConnect() {
  return (
    <section className="wallet-section">
      <div className="container">
        <FadeIn>
          <div className="wallet-section-head">
            <h2>Works where your apps run.</h2>
            <p>
              Each wallet serves the apps on its own device. Every path ends at a
              wallet you hold.
            </p>
          </div>
        </FadeIn>
        <div className="side-by-side-grid">
          {connectTargets.map((t, i) => (
            <FadeIn key={t.badge} delay={0.05 * (i % 2)}>
              <div className="sbs-card">
                <div className="sbs-badge">{t.badge}</div>
                <h3 className="sbs-title">{t.title}</h3>
                <p className="sbs-desc">{t.desc}</p>
                <div className="openclaw-flow" style={{ marginTop: 16, marginBottom: 0 }}>
                  {t.flow.map((step, j) => (
                    <FlowStep key={`${j}-${step.label}`} step={step} last={j === t.flow.length - 1} />
                  ))}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function FlowStep({ step, last }: { step: { label: string; sub?: string; highlight?: boolean }; last: boolean }) {
  return (
    <>
      <div className={`openclaw-flow-step${step.highlight ? ' openclaw-flow-highlight' : ''}`}>
        <span className="openclaw-flow-label">{step.label}</span>
        {step.sub && <span className="openclaw-flow-sub">{step.sub}</span>}
      </div>
      {!last && <span className="openclaw-flow-arrow">&rarr;</span>}
    </>
  );
}

/* ─── OpenClaw CTA ─────────────────────────────── */

function OpenClawCTA() {
  return (
    <section className="openclaw-cta-section">
      <div className="container">
        <FadeIn>
          <div className="openclaw-cta-card">
            <div className="openclaw-cta-copy">
              <div className="openclaw-cta-eyebrow">
                <span className="openclaw-cta-dot" />
                OpenClaw × Byoky
              </div>
              <h2 style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
                Run{' '}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg" alt="" width={24} height={24} />
                  Claude Code,
                </span>{' '}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg" alt="" width={24} height={24} />
                  Codex,
                </span>{' '}
                and{' '}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg" alt="" width={24} height={24} />
                  Gemini
                </span>{' '}
                in OpenClaw.
              </h2>
              <p>
                Use the keys already in your wallet, or an existing <strong>Claude Pro/Max</strong>{' '}
                subscription via a setup token. The plugin routes through the local
                bridge, so your keys stay in the wallet even when the agent runs in
                your terminal.
              </p>
              <div className="openclaw-cta-actions">
                <a href="/openclaw" className="btn btn-primary">
                  Read the 5-minute setup
                </a>
                <a href="/claude-code" className="btn btn-secondary">
                  Claude Code guide
                </a>
              </div>
            </div>
            <div className="openclaw-cta-visual" aria-hidden>
              <pre className="openclaw-cta-code">
<span className="tc">{'# Install the plugin (bridge bundled)'}</span>{'\n'}
<span className="tk">$</span> openclaw plugins install <span className="ts">@byoky/openclaw-plugin</span>{'\n'}
{'\n'}
<span className="tc">{'# Connect your wallet'}</span>{'\n'}
<span className="tk">$</span> openclaw models auth login {'\\'}
{'\n'}    --provider <span className="ts">byoky-anthropic</span>{'\n'}
{'\n'}
<span className="tv">{'✓'}</span> bridge running{'\n'}
<span className="tv">{'✓'}</span> <span className="tt">13</span> providers available
              </pre>
            </div>
          </div>
        </FadeIn>
      </div>
      <style>{`
        .openclaw-cta-section { padding: 80px 0; position: relative; }
        .openclaw-cta-card {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 48px;
          align-items: center;
          padding: 48px;
          border-radius: 20px;
          background:
            radial-gradient(circle at 0% 0%, rgba(255,79,0,0.08), transparent 50%),
            radial-gradient(circle at 100% 100%, rgba(255,79,0,0.05), transparent 50%),
            var(--bg-card);
          border: 1px solid rgba(255, 79, 0, 0.2);
        }
        .openclaw-cta-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--teal-light);
          margin-bottom: 14px;
        }
        .openclaw-cta-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--teal);
          box-shadow: 0 0 10px var(--teal-glow);
        }
        .openclaw-cta-copy h2 {
          font-size: 32px;
          line-height: 1.15;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0 0 16px;
        }
        .openclaw-cta-copy p {
          font-size: 16px;
          line-height: 1.65;
          color: var(--text-secondary);
          margin: 0 0 24px;
          max-width: 520px;
        }
        .openclaw-cta-copy strong { color: var(--text); }
        .openclaw-cta-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .openclaw-cta-visual {
          min-width: 0;
        }
        .openclaw-cta-code {
          margin: 0;
          padding: 22px 24px;
          background: #ffffff;
          border: 1px solid var(--border);
          border-radius: 12px;
          font-family: var(--font-mono), monospace;
          font-size: 13px;
          line-height: 1.75;
          color: var(--text);
          overflow-x: auto;
          white-space: pre;
          box-shadow: 0 20px 40px rgba(28, 25, 23, 0.06);
        }
        @media (max-width: 860px) {
          .openclaw-cta-section { padding: 56px 0; }
          .openclaw-cta-card {
            grid-template-columns: 1fr;
            gap: 28px;
            padding: 32px 24px;
          }
          .openclaw-cta-copy h2 { font-size: 26px; }
          .openclaw-cta-code { font-size: 12px; padding: 18px 18px; }
        }
      `}</style>
    </section>
  );
}

/* ─── For Developers ───────────────────────────── */

function ForDevelopers() {
  return (
    <section className="dev-section">
      <div className="container">
        <FadeIn>
          <h2>Build AI apps.<br />Your users bring the keys.</h2>
          <p className="subtitle">
            Integrate with any AI provider using their native SDK.
            Just swap in Byoky&apos;s fetch. Keys never touch your app, and
            your users pay their provider directly.
          </p>
          <p className="subtitle" style={{ fontSize: 14, marginBottom: 0, marginTop: 0 }}>
            <code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal-light)', fontSize: 13 }}>npm install @byoky/sdk</code> to add to an existing project
            {' · '}<code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal-light)', fontSize: 13 }}>npx create-byoky-app</code> to scaffold a new one
          </p>
        </FadeIn>
        <div className="dev-layout">
          <div>
            <FadeIn>
              <div className="dev-features">
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>Native SDK compatibility</h4>
                    <p>
                      Works with official SDKs from Anthropic, OpenAI, Gemini,
                      Mistral, and 9 more providers. Just swap in Byoky&apos;s fetch.
                    </p>
                  </div>
                </div>
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>Streaming out of the box</h4>
                    <p>
                      Full SSE streaming support through the wallet proxy. No
                      special handling needed.
                    </p>
                  </div>
                </div>
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>Built-in connect modal</h4>
                    <p>
                      <code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal-light)', fontSize: 13 }}>modal: true</code> handles the connect flow. No wallet
                      yet? It shows install links, and on phones it points users to
                      the Byoky app&apos;s built-in browser.
                    </p>
                  </div>
                </div>
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>Backend relay</h4>
                    <p>
                      Your server makes LLM calls through the user&apos;s browser
                      over a WebSocket you host. Keys never leave the wallet, even server-side.
                    </p>
                  </div>
                </div>
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>CLI &amp; local apps</h4>
                    <p>
                      The Byoky Bridge lets CLI tools and desktop apps route
                      through the wallet via a local HTTP proxy. Keys stay in the extension.
                    </p>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={0.15}>
            <CodeBlock />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function CodeBlock() {
  return (
    <div className="code-window">
      <div className="code-titlebar">
        <span className="code-dot code-dot-red" />
        <span className="code-dot code-dot-yellow" />
        <span className="code-dot code-dot-green" />
        <span className="code-filename">app.ts</span>
      </div>
      <div className="code-body">
        <pre>
          <code>
            <span className="tk">import</span> <span className="tt">Anthropic</span> <span className="tk">from</span> <span className="ts">&apos;@anthropic-ai/sdk&apos;</span><span className="tn">;</span>{'\n'}
            <span className="tk">import</span> <span className="tn">{'{'}</span> <span className="tt">Byoky</span> <span className="tn">{'}'}</span> <span className="tk">from</span> <span className="ts">&apos;@byoky/sdk&apos;</span><span className="tn">;</span>{'\n'}
            {'\n'}
            <span className="tk">const</span> <span className="tp">byoky</span> <span className="tn">=</span> <span className="tk">new</span> <span className="tt">Byoky</span><span className="tn">();</span>{'\n'}
            <span className="tk">const</span> <span className="tp">session</span> <span className="tn">=</span> <span className="tk">await</span> <span className="tp">byoky</span><span className="tn">.</span><span className="tp">connect</span><span className="tn">(</span><span className="tn">{'{'}</span>{'\n'}
            {'  '}<span className="tp">providers</span><span className="tn">:</span> <span className="tn">[{'{'}</span> <span className="tp">id</span><span className="tn">:</span> <span className="ts">&apos;anthropic&apos;</span><span className="tn">,</span> <span className="tp">required</span><span className="tn">:</span> <span className="tv">true</span> <span className="tn">{'}]'}</span><span className="tn">,</span>{'\n'}
            {'  '}<span className="tp">modal</span><span className="tn">:</span> <span className="tv">true</span><span className="tn">,</span> <span className="tc">{'// built-in connect + install UI'}</span>{'\n'}
            <span className="tn">{'}'});</span>{'\n'}
            {'\n'}
            <span className="tc">{'// Use the native Anthropic SDK — keys never exposed'}</span>{'\n'}
            <span className="tk">const</span> <span className="tp">client</span> <span className="tn">=</span> <span className="tk">new</span> <span className="tt">Anthropic</span><span className="tn">(</span><span className="tn">{'{'}</span>{'\n'}
            {'  '}<span className="tp">apiKey</span><span className="tn">:</span> <span className="tp">session</span><span className="tn">.</span><span className="tp">sessionKey</span><span className="tn">,</span>{'\n'}
            {'  '}<span className="tp">fetch</span><span className="tn">:</span> <span className="tp">session</span><span className="tn">.</span><span className="tp">createFetch</span><span className="tn">(</span><span className="ts">&apos;anthropic&apos;</span><span className="tn">),</span>{'\n'}
            <span className="tn">{'}'});</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ─── Security ─────────────────────────────────── */

function Security() {
  const items = [
    { icon: <LockIcon />, title: 'AES-256-GCM', desc: 'PBKDF2 600K iterations. Keychain / Keystore-backed on mobile.' },
    { icon: <ShieldIcon />, title: 'Zero key exposure', desc: 'Keys never leave the wallet. Apps get per-session tokens.' },
    { icon: <EyeIcon />, title: 'Full audit log', desc: 'Every request logged locally with origin, provider, and status.' },
    { icon: <GaugeIcon />, title: 'Spending caps', desc: 'Token allowances per app. The proxy enforces limits.' },
    { icon: <ArchiveIcon />, title: 'Encrypted backup', desc: 'Export .byoky files protected by a separate password.' },
    { icon: <CloudOffIcon />, title: 'No servers', desc: 'No accounts, no cloud sync, no relay, no telemetry.' },
  ];

  return (
    <section className="security-section">
      <div className="container">
        <FadeIn>
          <h2>Security isn&apos;t a feature. It&apos;s the architecture.</h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="security-strip">
            {items.map((item) => (
              <div key={item.title} className="security-strip-item">
                <div className="security-strip-icon">{item.icon}</div>
                <div>
                  <div className="security-strip-title">{item.title}</div>
                  <div className="security-strip-desc">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Open Source ───────────────────────────────── */

function ClosingStrip() {
  return (
    <section className="closing-strip">
      <div className="container">
        <div className="closing-strip-inner">
          <span className="closing-strip-label">Fully open source · MIT licensed · No hosted services</span>
          <div className="closing-strip-actions">
            <GitHubStarButton repo="MichaelLod/byoky" />
            <InstallWalletButton className="btn btn-primary btn-sm">
              Install Wallet
            </InstallWalletButton>
            <a href="/docs" className="closing-strip-link">
              Read the Docs
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ───────────────────────────────────── */

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-col">
            <span className="footer-brand">Byoky</span>
            <span className="footer-note">The MetaMask for API keys.</span>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Product</span>
            <a href="/docs">Docs</a>
            <a href="/demo">Demo</a>
            <a href="/chat">Chat</a>
            <a href="/openclaw">OpenClaw</a>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Resources</span>
            <a href="https://github.com/MichaelLod/byoky" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://github.com/MichaelLod/byoky/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
            <a href="/blog">Blog</a>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
          <div className="footer-col">
            <span className="footer-col-title">Install</span>
            <a href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon" target="_blank" rel="noopener noreferrer">Chrome</a>
            <a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" target="_blank" rel="noopener noreferrer">Firefox</a>
            <a href="https://apps.apple.com/app/byoky/id6760779919" target="_blank" rel="noopener noreferrer">iOS</a>
            <a href="https://play.google.com/store/apps/details?id=com.byoky.app" target="_blank" rel="noopener noreferrer">Android</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Icons (inline SVG) ───────────────────────── */

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function CloudOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}
