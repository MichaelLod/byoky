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
      <WhyByoky />
      <div className="divider" />
      <Providers />
      <div className="divider" />
      <ForDevelopers />
      <div className="divider" />
      <HowItWorks />
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
            Open-source wallet for AI keys
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="hero-mascot">
            <svg width="96" height="96" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="40,5 64,3 88,5 64,14" fill="#0ea5e9"/>
              <polygon points="40,5 22,12 44,18" fill="#0284c7"/>
              <polygon points="88,5 106,12 84,18" fill="#0284c7"/>
              <polygon points="40,5 44,18 64,14" fill="#0369a1"/>
              <polygon points="88,5 84,18 64,14" fill="#0369a1"/>
              <polygon points="22,12 12,26 36,26" fill="#075985"/>
              <polygon points="22,12 36,26 44,18" fill="#0369a1"/>
              <polygon points="106,12 116,26 92,26" fill="#075985"/>
              <polygon points="106,12 92,26 84,18" fill="#0369a1"/>
              <polygon points="44,18 36,26 56,30" fill="#0c4a6e"/>
              <polygon points="84,18 92,26 72,30" fill="#0c4a6e"/>
              <polygon points="44,18 56,30 64,14" fill="#075985"/>
              <polygon points="84,18 72,30 64,14" fill="#075985"/>
              <polygon points="64,14 56,30 64,28" fill="#0c4a6e"/>
              <polygon points="64,14 72,30 64,28" fill="#0c4a6e"/>
              <polygon points="12,26 6,42 30,40" fill="#082f49"/>
              <polygon points="12,26 30,40 36,26" fill="#082f49"/>
              <polygon points="116,26 122,42 98,40" fill="#082f49"/>
              <polygon points="116,26 98,40 92,26" fill="#082f49"/>
              <polygon points="36,26 30,40 48,38" fill="#1e0a4a"/>
              <polygon points="36,26 48,38 56,30" fill="#251055"/>
              <polygon points="92,26 98,40 80,38" fill="#1e0a4a"/>
              <polygon points="92,26 80,38 72,30" fill="#251055"/>
              <polygon points="56,30 64,28 60,44" fill="#9494a6"/>
              <polygon points="72,30 64,28 68,44" fill="#8a8a9c"/>
              <polygon points="60,44 64,28 68,44" fill="#7a7a8c"/>
              <polygon points="56,30 60,44 46,42" fill="#7a7a8c"/>
              <polygon points="72,30 68,44 82,42" fill="#6b6b7d"/>
              <polygon points="46,42 60,44 52,56" fill="#5e5e6e"/>
              <polygon points="82,42 68,44 76,56" fill="#52525e"/>
              <polygon points="60,44 68,44 64,60" fill="#6b6b7d"/>
              <polygon points="52,56 60,44 64,60" fill="#52525e"/>
              <polygon points="76,56 68,44 64,60" fill="#4a4a56"/>
              <polygon points="52,56 64,60 64,88" fill="#3f3f4a"/>
              <polygon points="76,56 64,60 64,88" fill="#353540"/>
              <polygon points="30,40 6,42 8,58" fill="#1e0a4a"/>
              <polygon points="30,40 8,58 32,54" fill="#1a0840"/>
              <polygon points="48,38 30,40 32,54" fill="#1e0a4a"/>
              <polygon points="48,38 32,54 46,42" fill="#251055"/>
              <polygon points="98,40 122,42 120,58" fill="#1e0a4a"/>
              <polygon points="98,40 120,58 96,54" fill="#1a0840"/>
              <polygon points="80,38 98,40 96,54" fill="#1e0a4a"/>
              <polygon points="80,38 96,54 82,42" fill="#251055"/>
              <polygon points="8,58 4,72 26,66" fill="#1a0840"/>
              <polygon points="8,58 26,66 32,54" fill="#1e0a4a"/>
              <polygon points="120,58 124,72 102,66" fill="#1a0840"/>
              <polygon points="120,58 102,66 96,54" fill="#1e0a4a"/>
              <polygon points="32,54 26,66 42,68" fill="#150835"/>
              <polygon points="32,54 42,68 46,42" fill="#1e0a4a"/>
              <polygon points="96,54 102,66 86,68" fill="#150835"/>
              <polygon points="96,54 86,68 82,42" fill="#1e0a4a"/>
              <polygon points="46,42 42,68 52,56" fill="#1e0a4a"/>
              <polygon points="82,42 86,68 76,56" fill="#1e0a4a"/>
              <polygon points="52,56 42,68 54,78" fill="#150835"/>
              <polygon points="76,56 86,68 74,78" fill="#150835"/>
              <polygon points="52,56 64,88 54,78" fill="#1a0840"/>
              <polygon points="76,56 64,88 74,78" fill="#1a0840"/>
              <polygon points="26,66 4,72 14,86" fill="#150835"/>
              <polygon points="26,66 14,86 36,80" fill="#110730"/>
              <polygon points="42,68 26,66 36,80" fill="#150835"/>
              <polygon points="42,68 36,80 48,82" fill="#110730"/>
              <polygon points="102,66 124,72 114,86" fill="#150835"/>
              <polygon points="102,66 114,86 92,80" fill="#110730"/>
              <polygon points="86,68 102,66 92,80" fill="#150835"/>
              <polygon points="86,68 92,80 80,82" fill="#110730"/>
              <polygon points="54,78 42,68 48,82" fill="#110730"/>
              <polygon points="74,78 86,68 80,82" fill="#110730"/>
              <polygon points="54,78 48,82 58,88" fill="#0d0525"/>
              <polygon points="74,78 80,82 70,88" fill="#0d0525"/>
              <polygon points="54,78 64,88 58,88" fill="#150835"/>
              <polygon points="74,78 64,88 70,88" fill="#150835"/>
              <polygon points="4,72 14,86 0,90" fill="#110730"/>
              <polygon points="124,72 114,86 128,90" fill="#110730"/>
              <polygon points="0,90 14,86 4,108" fill="#0d0525"/>
              <polygon points="128,90 114,86 124,108" fill="#0d0525"/>
              <polygon points="14,86 36,80 22,102" fill="#0d0525"/>
              <polygon points="14,86 22,102 6,106" fill="#0a0420"/>
              <polygon points="114,86 92,80 106,102" fill="#0d0525"/>
              <polygon points="114,86 106,102 122,106" fill="#0a0420"/>
              <polygon points="36,80 48,82 38,104" fill="#0d0525"/>
              <polygon points="36,80 38,104 24,108" fill="#0a0420"/>
              <polygon points="92,80 80,82 90,104" fill="#0d0525"/>
              <polygon points="92,80 90,104 104,108" fill="#0a0420"/>
              <polygon points="48,82 58,88 48,110" fill="#0a0420"/>
              <polygon points="48,82 48,110 36,112" fill="#0d0525"/>
              <polygon points="80,82 70,88 80,110" fill="#0a0420"/>
              <polygon points="80,82 80,110 92,112" fill="#0d0525"/>
              <polygon points="58,88 64,88 60,114" fill="#0a0420"/>
              <polygon points="70,88 64,88 68,114" fill="#0a0420"/>
              <circle cx="24" cy="46" r="4.5" fill="#7dd3fc"/>
              <circle cx="24" cy="46" r="2.2" fill="#e0d4ff"/>
              <circle cx="104" cy="46" r="4.5" fill="#7dd3fc"/>
              <circle cx="104" cy="46" r="2.2" fill="#e0d4ff"/>
            </svg>
          </div>
          <h1>
            <span className="hero-eyebrow">Bring Your Own Key.</span>
            <span className="hero-gradient">MetaMask for AI API Keys.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            15 providers. 2 lines to integrate. Cross-provider translation.
            Your keys stay encrypted on your device — apps never see them.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="hero-actions">
            <a
              href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DownloadIcon />
              Chrome Extension
            </a>
            <a
              href="https://addons.mozilla.org/en-US/firefox/addon/byoky/"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <DownloadIcon />
              Firefox Extension
            </a>
            <a
              href="https://apps.apple.com/app/byoky/id6760779919"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <AppleIcon />
              iOS App
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.byoky.app"
              className="btn btn-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              <AndroidIcon />
              Android App
            </a>
            <a
              href="/demo"
              className="btn btn-secondary"
            >
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
          </div>
        </FadeIn>
        <FadeIn delay={0.4}>
          <div className="hero-demo">
            <video
              autoPlay
              loop
              muted
              playsInline
              poster="/demos/hero-demo.gif"
            >
              <source src="/demos/hero-demo.mp4" type="video/mp4" />
            </video>
          </div>
        </FadeIn>
        <FadeIn delay={0.5}>
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
                Add the Byoky extension to Chrome, Firefox, or Safari — or
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

/* ─── Why Byoky ───────────────────────────────── */

function WhyByoky() {
  const features = [
    { label: 'User chooses model', byoky: true, paste: false, gateway: 'partial', vendor: false },
    { label: 'Keys stay on device', byoky: true, paste: false, gateway: false, vendor: false },
    { label: 'Cross-provider translation', byoky: true, paste: false, gateway: false, vendor: false },
    { label: 'Local + cloud models', byoky: true, paste: false, gateway: 'partial', vendor: 'partial' },
    { label: 'Mobile wallet + QR', byoky: true, paste: false, gateway: false, vendor: false },
    { label: 'Token gifting', byoky: true, paste: false, gateway: false, vendor: false },
    { label: 'Backend relay', byoky: true, paste: false, gateway: true, vendor: false },
    { label: 'Full audit log', byoky: true, paste: false, gateway: true, vendor: false },
    { label: 'Zero server cost', byoky: true, paste: false, gateway: false, vendor: false },
    { label: 'Integration effort', byoky: '2 lines', paste: '~40 lines', gateway: '~30 lines', vendor: '~15 lines' },
    { label: 'Open source', byoky: true, paste: 'varies', gateway: 'some', vendor: 'some' },
  ];

  function CellValue({ value }: { value: boolean | string }) {
    if (value === true) return <span className="compare-yes"><TableCheckIcon /></span>;
    if (value === false) return <span className="compare-no"><TableXIcon /></span>;
    return <span className="compare-partial">{value}</span>;
  }

  return (
    <section className="compare-section">
      <div className="container">
        <FadeIn>
          <h2>Why Byoky?</h2>
          <p className="subtitle">
            Stop pasting API keys into apps. Stop paying for AI gateways.
            Let your users bring their own keys.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="compare-highlight">Byoky</th>
                  <th>Paste API Key</th>
                  <th>AI Gateways</th>
                  <th>Vendor SDKs</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.label}>
                    <td className="compare-feature">{f.label}</td>
                    <td className="compare-highlight"><CellValue value={f.byoky} /></td>
                    <td><CellValue value={f.paste} /></td>
                    <td><CellValue value={f.gateway} /></td>
                    <td><CellValue value={f.vendor} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>
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
              <div className="section-demo">
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  poster="/demos/cross-provider.gif"
                >
                  <source src="/demos/cross-provider.mp4" type="video/mp4" />
                </video>
              </div>
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

function TableCheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function TableXIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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
