import { FadeIn } from './components/FadeIn';
import { AnimatedCounter } from './components/AnimatedCounter';
import { CopySnippet } from './components/CopySnippet';
import { VersionStatus } from './components/VersionStatus';
import { ProviderMarquee } from './components/ProviderMarquee';
import { WalletPreview, ConnectAppPreview, ChatMiniPreview } from './components/StepPreviews';

export default function Home() {
  return (
    <>
      <Hero />
      <ProviderMarquee />
      <HowItWorks />
      <div className="divider" />
      <ForDevelopers />
      <div className="divider" />
      <Security />
      <div className="divider" />
      <OpenSource />
      <Footer />
    </>
  );
}

/* ─── For Consumers ───────────────────────────────── */


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
            The payment layer for AI apps
          </div>
        </FadeIn>
        <FadeIn delay={0.05}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img src="/byoky-logo.gif" alt="Byoky" style={{ height: '100px', width: 'auto', marginBottom: '16px' }} />
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1>
            <span className="hero-gradient">One wallet.<br />Every AI app.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            Bring your own key or get one from us. Developers add one button and never pay for inference again.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '8px', flexWrap: 'wrap' }}>
            <a href="/openclaw" className="btn btn-primary">Try the OpenClaw Demo</a>
            <CopySnippet text="npm install @byoky/sdk" display="npm install @byoky/sdk" />
          </div>
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
              <div className="step-number"><WalletIcon /></div>
              <h3>Get a wallet</h3>
              <p>Sign up on any Byoky-enabled app or install the extension. One balance across every app.</p>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                <WalletPreview />
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="step">
              <div className="step-number"><LinkIcon /></div>
              <h3>Connect to any app</h3>
              <p>Click &ldquo;Pay with Byoky.&rdquo; Approve the connection. Choose your providers and models.</p>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                <ConnectAppPreview />
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="step">
              <div className="step-number"><CheckIcon /></div>
              <h3>AI just works</h3>
              <p>Your balance is charged per use. Switch models or providers anytime. Developers pay nothing.</p>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
                <ChatMiniPreview />
              </div>
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

/* ─── What You Can Build ──────────────────────────── */

function WhatYouCanBuild() {
  const tabs = [
    { name: 'Native SDK', desc: 'Use official SDKs from Anthropic, OpenAI, Gemini — just swap in Byoky\'s fetch' },
    { name: 'Structured Output', desc: 'JSON mode, function calling, structured responses — all work through the proxy' },
    { name: 'Streaming', desc: 'Full SSE streaming support. No special handling needed' },
    { name: 'Tool Use', desc: 'Function calling and tool use work transparently through the proxy layer' },
    { name: 'Vision', desc: 'Send images to multimodal models. Binary data is base64-encoded automatically' },
    { name: 'Backend Relay', desc: 'Your server makes LLM calls through the user\'s wallet via WebSocket' },
    { name: 'Multi-Provider', desc: 'Switch between 15+ providers with a config change. One SDK, all models' },
    { name: 'Bridge Proxy', desc: 'CLI and desktop apps route through the local Byoky Bridge. Keys never leave the extension' },
  ];

  return (
    <section className="zero-cost-section">
      <div className="container">
        <FadeIn>
          <h2 className="zero-cost-heading">What you can build</h2>
          <p className="zero-cost-body">
            Every example works through the Byoky proxy — your app never touches an API key.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginTop: '32px', marginBottom: '24px' }}>
            {tabs.map((tab) => (
              <span
                key={tab.name}
                style={{
                  padding: '8px 16px', borderRadius: '8px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)',
                }}
              >
                {tab.name}
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', maxWidth: '800px', margin: '0 auto' }}>
            {tabs.map((tab) => (
              <div
                key={tab.name}
                style={{
                  padding: '16px 20px', borderRadius: '12px',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                }}
              >
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>{tab.name}</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tab.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <a href="/demo" style={{ color: 'var(--teal)', fontSize: '14px', fontWeight: 500 }}>
              Try the interactive playground &rarr;
            </a>
          </div>
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
          <h2>Kill your API bill with two lines of code.</h2>
          <p className="subtitle">
            Your users pay for their own AI. Byoky handles the rest.
          </p>
          <p className="subtitle" style={{ fontSize: 14, marginBottom: 0, marginTop: 8 }}>
            <code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal)', fontSize: 13 }}>npm install @byoky/sdk</code> to add to an existing project
            {' · '}<code style={{ fontFamily: 'var(--font-code)', color: 'var(--teal)', fontSize: 13 }}>npx create-byoky-app</code> to scaffold a new one
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
                    <h4>Zero inference cost</h4>
                    <p>
                      Users pay for their own AI usage through their Byoky wallet.
                      Your AWS/API bill goes to zero. Revenue share via Stripe Connect.
                    </p>
                  </div>
                </div>
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
                      Full SSE streaming support through the proxy. No
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
                      Your server makes LLM calls through the user&apos;s wallet
                      via WebSocket. Keys never leave the wallet — even server-side.
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
                      through the wallet via a local HTTP proxy.
                    </p>
                  </div>
                </div>
                <div className="dev-feature">
                  <div className="dev-feature-icon">
                    <CheckIcon />
                  </div>
                  <div>
                    <h4>No extension required</h4>
                    <p>
                      Works with or without the browser extension. Web wallet
                      popup for zero-friction onboarding. Extension is optional.
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

        {/* OpenClaw callout */}
        <FadeIn delay={0.2}>
          <div style={{
            display: 'flex', gap: '32px', alignItems: 'flex-start',
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '16px', padding: '28px', marginTop: '48px',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--teal)' }}>OpenClaw</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>&times;</span>
                <span style={{ fontSize: '13px', fontWeight: 700 }}>Byoky</span>
              </div>
              <h3 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.01em' }}>
                Run Claude, GPT, and Gemini in OpenClaw — for free.
              </h3>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '16px' }}>
                Get a free token gift from the marketplace, or plug in your existing Claude Pro/Max subscription.
                Zero API credits, zero card on file — just a 5-minute setup.
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <a href="/openclaw" className="btn btn-primary" style={{ fontSize: '13px', padding: '8px 16px' }}>Read the 5-minute setup</a>
                <a href="/marketplace" className="btn btn-secondary" style={{ fontSize: '13px', padding: '8px 16px' }}>Browse free gifts</a>
              </div>
            </div>
            <div style={{
              width: '240px', flexShrink: 0,
              background: '#1a1a2e', borderRadius: '10px', padding: '14px 16px',
              fontFamily: 'var(--font-code, monospace)', fontSize: '11px', lineHeight: 1.7,
              color: '#e2e2ec', overflow: 'hidden',
            }}>
              <div><span style={{ color: 'var(--teal)' }}>$</span> npm install -g @byoky/bridge</div>
              <div><span style={{ color: 'var(--teal)' }}>$</span> npm install -g @byoky/openclaw-plugin</div>
              <div><span style={{ color: 'var(--teal)' }}>$</span> openclaw models auth login \</div>
              <div style={{ paddingLeft: '16px' }}>--provider byoky-anthropic</div>
              <div style={{ marginTop: '8px', color: '#22c55e' }}>&#10003; bridge running</div>
              <div style={{ color: '#22c55e' }}>&#10003; 15 providers available</div>
            </div>
          </div>
        </FadeIn>
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
          <h2>Got your own keys?</h2>
          <p className="subtitle">
            Install the browser extension. Bring your own API keys. Full local encryption, zero cloud dependency.
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
                <CloudOffIcon />
              </div>
              <h3>Local &amp; encrypted</h3>
              <p>
                No cloud. No telemetry. Everything on your device, encrypted behind your master password. Export as an encrypted .byoky backup file anytime.
              </p>
            </div>
          </FadeIn>
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
    { name: 'Hugging Face', type: 'API Key + OAuth', cls: 'huggingface', letter: 'H' },
    { name: 'Replicate', type: 'API Key', cls: 'replicate', letter: 'R' },
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
                you scan it with the Byoky iOS app, and your keys proxy through
                your phone. Works on any browser, any computer. Keep the app
                open while using the web app.
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

/* ─── OpenClaw Integration ─────────────────────── */

function OpenClawIntegration() {
  return (
    <section className="openclaw-section">
      <div className="container">
        <FadeIn>
          <div className="openclaw-card">
            <div className="openclaw-badge">Integration</div>
            <div className="openclaw-content">
              <div className="openclaw-header">
                <div className="openclaw-logo">
                  <TerminalIcon />
                </div>
                <div>
                  <h3>Works with OpenClaw</h3>
                  <p className="openclaw-tagline">
                    Use your Byoky wallet as the key provider for OpenClaw.
                  </p>
                </div>
              </div>
              <p className="openclaw-desc">
                The OpenClaw plugin connects through the Byoky Bridge — a local
                HTTP proxy that routes every API call through your extension. Your
                keys never leave the wallet, even when OpenClaw makes requests
                from the CLI.
              </p>
              <div className="openclaw-flow">
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">OpenClaw</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Bridge</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Extension</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">LLM API</span>
                </div>
              </div>
              <div className="openclaw-actions">
                <a
                  href="https://github.com/MichaelLod/byoky/tree/main/packages/openclaw-plugin"
                  className="btn btn-secondary btn-sm"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Plugin
                </a>
                <a
                  href="https://github.com/MichaelLod/byoky/tree/main/packages/bridge"
                  className="btn btn-secondary btn-sm"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Bridge Docs
                </a>
              </div>
            </div>
          </div>
        </FadeIn>
        <FadeIn delay={0.15}>
          <div className="openclaw-card openclaw-card-remote">
            <div className="openclaw-badge">Cloud</div>
            <div className="openclaw-content">
              <div className="openclaw-header">
                <div className="openclaw-logo openclaw-logo-cloud">
                  <CloudIcon />
                </div>
                <div>
                  <h3>Remote OpenClaw</h3>
                  <p className="openclaw-tagline">
                    Run OpenClaw in the cloud. Keys stay on your device.
                  </p>
                </div>
              </div>
              <p className="openclaw-desc">
                Deploy OpenClaw on Railway, Fly.io, or any cloud provider and
                connect it to your Byoky wallet via the relay. Your server never
                sees your API keys — no environment variables, no secrets
                management, no leaked <code>.env</code> files.
              </p>
              <div className="openclaw-flow">
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">OpenClaw</span>
                  <span className="openclaw-flow-sub">Railway</span>
                </div>
                <span className="openclaw-flow-arrow">&harr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">Relay</span>
                  <span className="openclaw-flow-sub">WebSocket</span>
                </div>
                <span className="openclaw-flow-arrow">&harr;</span>
                <div className="openclaw-flow-step openclaw-flow-highlight">
                  <span className="openclaw-flow-label">Your Wallet</span>
                  <span className="openclaw-flow-sub">Keys stay here</span>
                </div>
                <span className="openclaw-flow-arrow">&rarr;</span>
                <div className="openclaw-flow-step">
                  <span className="openclaw-flow-label">LLM API</span>
                </div>
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
            <a href="/demo">
              Demo
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

function CloudIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
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

function TerminalIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
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
