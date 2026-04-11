import { FadeIn } from './components/FadeIn';
import { AnimatedCounter } from './components/AnimatedCounter';
import { VersionStatus } from './components/VersionStatus';

export default function Home() {
  return (
    <>
      <Hero />
      <div className="divider" />
      <ZeroCost />
      <div className="divider" />
      <OpenClawCTA />
      <div className="divider" />
      <Showcase />
      <div className="divider" />
      <ForDevelopers />
      <div className="divider" />
      <HowItWorks />
      <div className="divider" />
      <Providers />
      <div className="divider" />
      <ThreatContext />
      <div className="divider" />
      <Security />
      <div className="divider" />
      <CrossProviderRouting />
      <div className="divider" />
      <MobileWallet />
      <div className="divider" />
      <OpenSource />
      <ClosingCTA />
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
            Open-source &middot; 15 providers &middot; 2 lines to integrate
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1>
            <span className="hero-eyebrow">Bring Your Own Key.</span>
            <span className="hero-gradient">Build AI apps. Pay nothing for AI.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            Your users connect their own API keys through Byoky.
            You get Claude, GPT-4, Gemini, and 12 more providers —
            without spending a cent on infrastructure.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="hero-actions">
            <a
              href="/docs"
              className="btn btn-primary"
            >
              Start Building
            </a>
            <a
              href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
              className="btn btn-secondary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DownloadIcon />
              Install Wallet
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
        </FadeIn>
        <FadeIn delay={0.35}>
          <div className="hero-trust-bar">
            <div className="hero-trust-item">
              <LinkIcon />
              <span>15 Providers</span>
            </div>
            <div className="hero-trust-item">
              <CheckIcon />
              <span>2 Lines to Integrate</span>
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
          <h2>How it works</h2>
        </FadeIn>
        <div className="steps-grid">
          <FadeIn delay={0.1}>
            <div className="step">
              <div className="step-number">
                <WalletIcon />
              </div>
              <h3>Install the wallet</h3>
              <p>
                Add the Byoky extension to Chrome or Firefox — or
                grab the iOS or Android app. Set a master password to
                encrypt your vault.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="step">
              <div className="step-number">
                <KeyIcon />
              </div>
              <h3>Add your keys</h3>
              <p>
                Paste API keys or add a Claude setup token. Everything is
                encrypted locally with AES-256-GCM. Multiple keys per provider.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="step">
              <div className="step-number">
                <LinkIcon />
              </div>
              <h3>Connect to any app</h3>
              <p>
                Visit any Byoky-enabled app. Approve access in one click. Your
                keys stay in the vault — always.
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Threat Context ──────────────────────────── */

function ThreatContext() {
  return (
    <section className="threat-section">
      <div className="container">
        <FadeIn>
          <h2>Why users trust Byoky with their keys.</h2>
          <p className="subtitle">
            Chrome extensions that handle API keys have a track record of abuse.
            Byoky was built to be the exception.
          </p>
        </FadeIn>
        <div className="threat-grid">
          <FadeIn delay={0.05}>
            <div className="threat-card">
              <span className="threat-stat">10,000+</span>
              <span className="threat-label">users exposed by a fake ChatGPT Chrome extension</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="threat-card">
              <span className="threat-stat">900K</span>
              <span className="threat-label">users compromised by extensions stealing AI conversations</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="threat-card">
              <span className="threat-stat">$8.5M</span>
              <span className="threat-label">in crypto stolen through a Chrome extension compromise</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="threat-card">
              <span className="threat-stat">30+</span>
              <span className="threat-label">malicious AI extensions caught in 2025&ndash;2026</span>
            </div>
          </FadeIn>
        </div>
        <FadeIn delay={0.25}>
          <p className="threat-cta">
            Byoky encrypts keys locally with AES-256-GCM, proxies every request,
            and gives users full visibility into what apps access. Your users
            install it once and trust every app you build.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Zero Cost ───────────────────────────────── */

function ZeroCost() {
  return (
    <section className="zero-cost-section">
      <div className="zero-cost-glow" aria-hidden />
      <div className="container">
        <FadeIn>
          <h2 className="zero-cost-heading">
            Build AI apps.<br />
            <span className="hero-gradient">Pay nothing for AI.</span>
          </h2>
          <p className="zero-cost-body">
            Stop worrying about API bills killing your project.
            Your users connect their own AI keys through Byoky — you
            get the full power of Claude, GPT-4, Gemini, and 12 more
            providers without spending a cent on infrastructure.
          </p>
        </FadeIn>
        <div className="zero-cost-grid">
          <FadeIn delay={0.1}>
            <div className="zero-cost-card">
              <span className="zero-cost-stat">$0</span>
              <span className="zero-cost-label">your AI cost — forever</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="zero-cost-card">
              <AnimatedCounter value={15} />
              <span className="zero-cost-label">AI providers supported</span>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="zero-cost-card">
              <AnimatedCounter value={2} />
              <span className="zero-cost-label">lines to integrate</span>
            </div>
          </FadeIn>
        </div>
        <FadeIn delay={0.4}>
          <p className="zero-cost-pitch">
            Indie dev? Startup? Side project? It doesn&apos;t matter.
            If your users have API keys, you have a product. No billing
            integration, no usage caps, no margin pressure.
          </p>
        </FadeIn>
      </div>
    </section>
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
              <h2>
                Run <span className="hero-gradient">Claude, GPT, and Gemini</span>{' '}
                in OpenClaw — for free.
              </h2>
              <p>
                Get a free token gift from the marketplace, or plug in your
                existing <strong>Claude Pro/Max</strong> subscription. Either way,
                zero API credits, zero card on file — just a 5-minute setup.
              </p>
              <div className="openclaw-cta-actions">
                <a href="/openclaw" className="btn btn-primary">
                  Read the 5-minute setup
                </a>
                <a href="/marketplace" className="btn btn-secondary">
                  Browse free gifts
                </a>
              </div>
            </div>
            <div className="openclaw-cta-visual" aria-hidden>
              <pre className="openclaw-cta-code">
{`$ npm install -g @byoky/bridge
$ npm install -g @byoky/openclaw-plugin
$ openclaw models auth login \\
    --provider byoky-anthropic
✓ bridge running
✓ 15 providers available`}
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
            radial-gradient(circle at 0% 0%, rgba(14,165,233,0.12), transparent 50%),
            radial-gradient(circle at 100% 100%, rgba(14,165,233,0.08), transparent 50%),
            var(--bg-card);
          border: 1px solid rgba(14, 165, 233, 0.28);
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
          background: #07070f;
          border: 1px solid var(--border);
          border-radius: 12px;
          font-family: var(--font-mono), monospace;
          font-size: 13px;
          line-height: 1.75;
          color: var(--teal-light);
          overflow-x: auto;
          white-space: pre;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
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
          <h2>Two lines of code. Full AI power.</h2>
          <p className="subtitle">
            Integrate with any AI provider using their native SDK.
            Just swap in Byoky&apos;s fetch — keys never touch your app.
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
                      Mistral, and 11 more providers. Just swap in Byoky&apos;s fetch.
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
                      Full SSE streaming support through the extension proxy. No
                      special handling needed.
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
                      via WebSocket. Keys never leave the extension — even server-side.
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
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>Token gifts</h4>
                    <p>
                      Let users share token access without sharing API keys.
                      Relay-backed with budget caps, expiry, and instant revocation.
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
            {'  '}<span className="tp">modal</span><span className="tn">:</span> <span className="tv">true</span><span className="tn">,</span> <span className="tc">{'// built-in connect UI with QR code'}</span>{'\n'}
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
  return (
    <section className="security-section">
      <div className="container">
        <FadeIn>
          <h2>Built for paranoia.</h2>
          <p className="subtitle">
            Security isn&apos;t a feature — it&apos;s the entire point.
          </p>
        </FadeIn>
        <div className="security-grid">
          <FadeIn delay={0.05}>
            <div className="security-card">
              <div className="security-icon">
                <LockIcon />
              </div>
              <h3>AES-256-GCM encryption</h3>
              <p>
                Keys encrypted with PBKDF2 (600K iterations). 12-character minimum
                with real-time strength meter. Web Crypto API — no dependencies.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="security-card">
              <div className="security-icon">
                <ShieldIcon />
              </div>
              <h3>Zero key exposure</h3>
              <p>
                API keys never leave the extension process. Apps receive
                temporary session tokens. The extension proxies every request.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="security-card">
              <div className="security-icon">
                <EyeIcon />
              </div>
              <h3>Full audit log</h3>
              <p>
                Every API request is logged with the app origin, provider,
                status, and timestamp. Complete visibility into credential usage.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.17}>
            <div className="security-card">
              <div className="security-icon">
                <GaugeIcon />
              </div>
              <h3>Spending caps</h3>
              <p>
                Set token allowances per app — total or per provider.
                The proxy enforces limits so no app can overspend.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.19}>
            <div className="security-card">
              <div className="security-icon">
                <GiftIcon />
              </div>
              <h3>Relay-backed gifting</h3>
              <p>
                Share token access with anyone — your API key stays in your wallet.
                Requests relay through you. Budget-capped with instant revocation.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="security-card">
              <div className="security-icon">
                <ArchiveIcon />
              </div>
              <h3>Encrypted vault backup</h3>
              <p>
                Export your vault as an encrypted .byoky file with a separate
                backup password. Import on any device.
              </p>
            </div>
          </FadeIn>
          <FadeIn delay={0.25}>
            <div className="security-card">
              <div className="security-icon">
                <CloudOffIcon />
              </div>
              <h3>Local only</h3>
              <p>
                No cloud. No telemetry. No tracking. Everything is stored on
                your device, encrypted behind your master password.
              </p>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* ─── Showcase ────────────────────────────────── */

const showcaseItems = [
  {
    label: 'Connect & Chat',
    desc: 'One click to connect. Stream AI responses through your wallet.',
    mp4: '/demos/hero-demo.mp4',
    gif: '/demos/hero-demo.gif',
  },
  {
    label: 'Cross-Provider Routing',
    desc: 'Drag an app between groups — the wallet translates on the fly.',
    mp4: '/demos/cross-provider.mp4',
    gif: '/demos/cross-provider.gif',
  },
  {
    label: 'Mobile QR Pairing',
    desc: 'No extension? Scan a QR code with the Byoky app. Keys proxy through your phone.',
    mp4: '/demos/mobile-qr.mp4',
    gif: '/demos/mobile-qr.gif',
  },
  {
    label: 'Token Gifts',
    desc: 'Share AI access without sharing your key. Set a budget, generate a link, revoke anytime.',
    mp4: '/demos/token-gift.mp4',
    gif: '/demos/token-gift.gif',
  },
];

function Showcase() {
  return (
    <section className="showcase-section">
      <div className="container">
        <FadeIn>
          <h2>See it in action.</h2>
        </FadeIn>
        <div className="showcase-grid">
          {showcaseItems.map((item, i) => (
            <FadeIn key={item.label} delay={0.1 * i}>
              <div className="showcase-cell">
                <div className="showcase-video">
                  <video autoPlay loop muted playsInline poster={item.gif}>
                    <source src={item.mp4} type="video/mp4" />
                  </video>
                </div>
                <div className="showcase-info">
                  <h3>{item.label}</h3>
                  <p>{item.desc}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Providers ────────────────────────────────── */

function Providers() {
  const row1 = [
    { name: 'Anthropic', type: 'API Key + Setup Token', cls: 'anthropic', letter: 'A' },
    { name: 'OpenAI', type: 'API Key', cls: 'openai', letter: 'O' },
    { name: 'Google Gemini', type: 'API Key + OAuth', cls: 'gemini', letter: 'G' },
    { name: 'Mistral', type: 'API Key', cls: 'mistral', letter: 'M' },
    { name: 'xAI (Grok)', type: 'API Key', cls: 'xai', letter: 'X' },
    { name: 'DeepSeek', type: 'API Key', cls: 'deepseek', letter: 'D' },
    { name: 'Cohere', type: 'API Key', cls: 'cohere', letter: 'C' },
    { name: 'Groq', type: 'API Key', cls: 'groq', letter: 'G' },
  ];
  const row2 = [
    { name: 'Perplexity', type: 'API Key', cls: 'perplexity', letter: 'P' },
    { name: 'Together AI', type: 'API Key', cls: 'together', letter: 'T' },
    { name: 'Fireworks AI', type: 'API Key', cls: 'fireworks', letter: 'F' },
    { name: 'OpenRouter', type: 'API Key', cls: 'openrouter', letter: 'O' },
    { name: 'Azure OpenAI', type: 'API Key', cls: 'azure', letter: 'A' },
  ];

  return (
    <section className="providers-section">
      <div className="container">
        <FadeIn>
          <h2>Your providers.</h2>
          <p className="subtitle">
            15 providers supported. Bring credentials from any of them.
          </p>
        </FadeIn>
      </div>
      <FadeIn delay={0.1}>
        <div className="providers-marquee">
          <div className="providers-track">
            {[...row1, ...row1].map((p, i) => (
              <div key={i} className="provider-card">
                <div className={`provider-logo provider-logo-${p.cls}`}>{p.letter}</div>
                <div>
                  <div className="provider-name">{p.name}</div>
                  <div className="provider-type">{p.type}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="providers-track providers-track-reverse">
            {[...row2, ...row2].map((p, i) => (
              <div key={i} className="provider-card">
                <div className={`provider-logo provider-logo-${p.cls}`}>{p.letter}</div>
                <div>
                  <div className="provider-name">{p.name}</div>
                  <div className="provider-type">{p.type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </FadeIn>
    </section>
  );
}

/* ─── Cross-Provider Routing ───────────────────── */

function CrossProviderRouting() {
  return (
    <section className="openclaw-section">
      <div className="container">
        <FadeIn>
          <div className="openclaw-card">
            <div className="openclaw-badge">New</div>
            <div className="openclaw-content">
              <div className="openclaw-header">
                <div className="openclaw-logo openclaw-logo-cloud">
                  <ShuffleIcon />
                </div>
                <div>
                  <h3>One App. Any Provider.</h3>
                  <p className="openclaw-tagline">
                    Drag an app between groups to swap which model it talks to —
                    even across providers.
                  </p>
                </div>
              </div>
              <p className="openclaw-desc">
                Bucket your connected apps into groups and pin each group to a
                credential. Move an app from a Claude group into a GPT group
                and the wallet transparently translates the request — Anthropic
                ↔ OpenAI ↔ Gemini ↔ Cohere. Request bodies, response bodies,
                and SSE streams are rewritten on the fly. Apps keep calling
                their preferred SDK; the wallet picks the upstream.
              </p>
              <div className="openclaw-flow">
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Your App</span>
                  <span className="openclaw-flow-sub">Anthropic SDK</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Wallet</span>
                  <span className="openclaw-flow-sub">Translates on the fly</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">GPT-4o</span>
                  <span className="openclaw-flow-sub">OpenAI API</span>
                </div>
              </div>
              <p className="openclaw-desc">
                <strong>No code changes.</strong> Live sessions reroute the next
                request automatically. Run the same agent on Claude one day and
                GPT the next without touching a line of code. Try a new model
                without rewriting your prompts.
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Mobile Wallet ────────────────────────────── */

function MobileWallet() {
  return (
    <section className="openclaw-section">
      <div className="container">
        <FadeIn>
          <div className="openclaw-card">
            <div className="openclaw-badge">Mobile</div>
            <div className="openclaw-content">
              <div className="openclaw-header">
                <div className="openclaw-logo openclaw-logo-cloud">
                  <PhoneIcon />
                </div>
                <div>
                  <h3>No Extension? Use Your Phone</h3>
                  <p className="openclaw-tagline">
                    Connect any browser to your Byoky mobile wallet via QR code.
                  </p>
                </div>
              </div>
              <p className="openclaw-desc">
                No browser extension needed. The web app shows a pairing code,
                you scan it with the Byoky iOS or Android app, and your keys
                proxy through your phone. Works on any browser, any computer.
                Keep the app open while using the web app.
              </p>
              <div className="openclaw-flow">
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Web App</span>
                  <span className="openclaw-flow-sub">Any browser</span>
                </div>
                <span className="openclaw-flow-arrow">&harr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Relay</span>
                  <span className="openclaw-flow-sub">WebSocket</span>
                </div>
                <span className="openclaw-flow-arrow">&harr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Phone Wallet</span>
                  <span className="openclaw-flow-sub">Keys stay here</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">LLM API</span>
                </div>
              </div>
              <div className="code-block">
                <div className="code-header">
                  <div className="code-dots">
                    <span className="code-dot code-dot-red" />
                    <span className="code-dot code-dot-yellow" />
                    <span className="code-dot code-dot-green" />
                  </div>
                  <span className="code-filename">app.ts</span>
                </div>
                <pre className="code-body"><code>{`const session = await byoky.connect({
  providers: [{ id: 'anthropic' }],
  useRelay: true,
  modal: true, // built-in connect UI with QR code
});
// Works exactly the same as extension mode`}</code></pre>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}


/* ─── Open Source ───────────────────────────────── */

function OpenSource() {
  return (
    <section className="oss-section">
      <div className="container">
        <FadeIn>
          <h2>Built in the open.</h2>
          <p className="subtitle">
            Byoky is fully open source under the MIT license. Audit the code,
            contribute, or fork it.
          </p>
          <a
            href="https://github.com/MichaelLod/byoky"
            className="oss-badge"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubIcon />
            Star on GitHub
          </a>
          <p className="oss-license">MIT License — free forever.</p>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Closing CTA ─────────────────────────────── */

function ClosingCTA() {
  return (
    <section className="cta-section">
      <div className="cta-glow" aria-hidden />
      <div className="container">
        <FadeIn>
          <h2>Ready to own your AI keys?</h2>
          <p className="subtitle">
            Install in 30 seconds. No account required.
          </p>
          <div className="cta-actions">
            <a
              href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DownloadIcon />
              Install for Chrome
            </a>
            <a
              href="/docs"
              className="btn btn-secondary"
            >
              Read the Docs
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─── Footer ───────────────────────────────────── */

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
            <a href="/docs">
              Docs
            </a>
            <a href="/apps">
              App Store
            </a>
            <a href="/marketplace">
              Token Marketplace
            </a>
            <a href="/demo">
              Demo
            </a>
            <a
              href="https://github.com/MichaelLod/byoky/tree/main/packages/openclaw-plugin"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenClaw Plugin
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

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
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

function PhoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
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

function GiftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12v10H4V12" />
      <path d="M2 7h20v5H2z" />
      <path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
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

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 12.04c-.03-2.93 2.39-4.34 2.5-4.41-1.36-1.99-3.48-2.27-4.24-2.3-1.81-.18-3.53 1.06-4.45 1.06-.92 0-2.34-1.04-3.85-1.01-1.98.03-3.81 1.15-4.83 2.92-2.06 3.57-.53 8.85 1.48 11.75.98 1.42 2.15 3.01 3.69 2.95 1.48-.06 2.04-.96 3.83-.96 1.79 0 2.29.96 3.86.93 1.59-.03 2.6-1.45 3.58-2.87 1.13-1.65 1.59-3.24 1.62-3.32-.04-.02-3.11-1.19-3.14-4.74zM14.13 3.71c.81-.99 1.36-2.36 1.21-3.71-1.17.05-2.59.78-3.43 1.76-.75.87-1.41 2.27-1.23 3.59 1.31.1 2.64-.66 3.45-1.64z" />
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.523 15.341c-.5523 0-1-.4477-1-1s.4477-1 1-1 1 .4477 1 1-.4477 1-1 1m-11.046 0c-.5523 0-1-.4477-1-1s.4477-1 1-1 1 .4477 1 1-.4477 1-1 1m11.405-6.02 1.997-3.46a.416.416 0 0 0-.152-.567.416.416 0 0 0-.567.152l-2.022 3.503A12.595 12.595 0 0 0 12 7.812c-1.85 0-3.595.397-5.138 1.137L4.84 5.446a.416.416 0 0 0-.567-.152.416.416 0 0 0-.152.567l1.997 3.46C2.69 11.187.5 14.456 0 18.32h24c-.5-3.864-2.69-7.133-6.118-8.999" />
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
