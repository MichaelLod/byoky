import { FadeIn } from './components/FadeIn';

export default function Home() {
  return (
    <>
      <Hero />
      <div className="divider" />
      <HowItWorks />
      <div className="divider" />
      <ForDevelopers />
      <div className="divider" />
      <Security />
      <div className="divider" />
      <Providers />
      <div className="divider" />
      <OpenSource />
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
      <div className="container">
        <FadeIn>
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            Open-source browser extension
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="hero-mascot">
            <svg width="80" height="80" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
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
              <polygon points="58,64 70,64 64,90" fill="#3f3f4a"/>
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
              <polygon points="98,40 122,42 120,58" fill="#1e0a4a"/>
              <polygon points="98,40 120,58 96,54" fill="#1a0840"/>
              <polygon points="8,58 4,72 26,66" fill="#1a0840"/>
              <polygon points="120,58 124,72 102,66" fill="#1a0840"/>
              <polygon points="16,66 24,80 8,86" fill="#150835"/>
              <polygon points="112,66 104,80 120,86" fill="#150835"/>
              <polygon points="8,86 24,80 14,106" fill="#110730"/>
              <polygon points="120,86 104,80 114,106" fill="#110730"/>
              <polygon points="40,92 54,96 46,118" fill="#0d0525"/>
              <polygon points="88,92 74,96 82,118" fill="#0d0525"/>
              <polygon points="54,96 64,100 56,122" fill="#0a0420"/>
              <polygon points="74,96 64,100 72,122" fill="#0a0420"/>
              <polygon points="56,122 64,100 64,128" fill="#0d0525"/>
              <polygon points="72,122 64,100 64,128" fill="#0d0525"/>
              <circle cx="24" cy="46" r="4.5" fill="#7dd3fc"/>
              <circle cx="24" cy="46" r="2.2" fill="#e0d4ff"/>
              <circle cx="104" cy="46" r="4.5" fill="#7dd3fc"/>
              <circle cx="104" cy="46" r="2.2" fill="#e0d4ff"/>
            </svg>
          </div>
          <h1>
            <span className="hero-gradient">MetaMask for AI.</span>
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p>
            A secure browser wallet for your LLM API keys and auth tokens.
            Connect to any app — your keys never leave the extension.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="hero-actions">
            <a
              href="https://github.com/MichaelLod/byoky"
              className="btn btn-primary"
            >
              <DownloadIcon />
              Install Extension
            </a>
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
                Add the Byoky extension to Chrome, Firefox, or Safari. Set a
                master password to encrypt your vault.
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
                Paste API keys or sign in with OAuth. Everything is encrypted
                locally with AES-256-GCM. Multiple keys per provider.
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

/* ─── For Developers ───────────────────────────── */

function ForDevelopers() {
  return (
    <section className="dev-section">
      <div className="container">
        <FadeIn>
          <h2>Integrate in minutes.</h2>
          <p className="subtitle">
            Use your favorite provider SDK with Byoky&apos;s fetch proxy. Two
            extra lines. Full API compatibility. Keys never touch your app.
          </p>
          <div className="install-cmd">
            <code>npm install @byoky/sdk</code>
          </div>
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
                      Works with the official Anthropic, OpenAI, and Gemini SDKs.
                      Just swap in Byoky&apos;s fetch.
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
                    <h4>Provider discovery</h4>
                    <p>
                      Detect which providers the user has. Request specific
                      providers or accept any available one.
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
            {'  '}<span className="tp">providers</span><span className="tn">:</span> <span className="tn">[{'{'}</span> <span className="tp">id</span><span className="tn">:</span> <span className="ts">&apos;anthropic&apos;</span><span className="tn">,</span> <span className="tp">required</span><span className="tn">:</span> <span className="tv">true</span> <span className="tn">{'}]'}</span>{'\n'}
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
                Keys are encrypted with a password-derived key using PBKDF2 with
                600,000 iterations. Web Crypto API — no dependencies.
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
          <FadeIn delay={0.2}>
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

/* ─── Providers ────────────────────────────────── */

function Providers() {
  return (
    <section className="providers-section">
      <div className="container">
        <FadeIn>
          <h2>Your providers.</h2>
          <p className="subtitle">
            Bring credentials from any supported provider.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="providers-row">
            <div className="provider-card">
              <div className="provider-logo provider-logo-anthropic">A</div>
              <div>
                <div className="provider-name">Anthropic</div>
                <div className="provider-type">API Key + OAuth</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-openai">O</div>
              <div>
                <div className="provider-name">OpenAI</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-gemini">G</div>
              <div>
                <div className="provider-name">Google Gemini</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-mistral">M</div>
              <div>
                <div className="provider-name">Mistral</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-xai">X</div>
              <div>
                <div className="provider-name">xAI (Grok)</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-deepseek">D</div>
              <div>
                <div className="provider-name">DeepSeek</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
          </div>
          <div className="providers-row" style={{ marginTop: '12px' }}>
            <div className="provider-card">
              <div className="provider-logo provider-logo-cohere">C</div>
              <div>
                <div className="provider-name">Cohere</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-groq">G</div>
              <div>
                <div className="provider-name">Groq</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-perplexity">P</div>
              <div>
                <div className="provider-name">Perplexity</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-huggingface">H</div>
              <div>
                <div className="provider-name">Hugging Face</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-openrouter">O</div>
              <div>
                <div className="provider-name">OpenRouter</div>
                <div className="provider-type">API Key</div>
              </div>
            </div>
            <div className="provider-card">
              <div className="provider-logo provider-logo-more">+</div>
              <div>
                <div className="provider-name">+ 5 more</div>
                <div className="provider-type">Together, Fireworks, Replicate, Azure, Custom</div>
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
