'use client';

import { useState } from 'react';

const sections = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'sdk', label: 'SDK Reference' },
  { id: 'session', label: 'Session API' },
  { id: 'app-ecosystem', label: 'App Ecosystem' },
  { id: 'manifest', label: 'App Manifest' },
  { id: 'backend-relay', label: 'Backend Relay' },
  { id: 'bridge', label: 'Bridge (CLI)' },
  { id: 'providers', label: 'Providers' },
] as const;

export default function Docs() {
  const [active, setActive] = useState('getting-started');

  return (
    <div className="docs-layout">
      <nav className="docs-nav">
        <div className="docs-nav-title">Docs</div>
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={`docs-nav-link ${active === s.id ? 'active' : ''}`}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <main className="docs-content">
        <GettingStarted />
        <SdkReference />
        <SessionApi />
        <AppEcosystem />
        <AppManifest />
        <BackendRelay />
        <Bridge />
        <ProvidersSection />
      </main>

      <style>{docsStyles}</style>
    </div>
  );
}

/* ─── Sections ─────────────────────────────────── */

function GettingStarted() {
  return (
    <Section id="getting-started" title="Getting Started">
      <p>
        Byoky lets users store their AI API keys in an encrypted wallet. Your app never sees the keys
        &mdash; it gets a proxied session that routes requests through the wallet.
      </p>

      <h3>Install the SDK</h3>
      <Code lang="bash">{`npm install @byoky/sdk`}</Code>

      <h3>Connect and make requests</h3>
      <Code lang="typescript">{`import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,  // shows built-in connect UI with QR code
});

// Use the native Anthropic SDK — just swap in Byoky's fetch
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});`}</Code>

      <p>
        Two lines changed. Full API compatibility. Streaming, file uploads, and vision all work.
        Sessions auto-reconnect if the extension restarts.
      </p>

      <h3>How it works</h3>
      <Code lang="text">{`Your App → SDK (createFetch) → Content Script → Extension → LLM API
                                                    ↑
                                          Keys stay here. Always.`}</Code>
    </Section>
  );
}

function SdkReference() {
  return (
    <Section id="sdk" title="SDK Reference">
      <h3>Constructor</h3>
      <Code lang="typescript">{`import { Byoky } from '@byoky/sdk';

const byoky = new Byoky({
  timeout: 60000,                      // connection timeout (ms)
  relayUrl: 'wss://relay.byoky.com',   // relay server for mobile pairing
});`}</Code>

      <h3>byoky.connect(options)</h3>
      <p>Connect to a Byoky wallet. Returns a <code>ByokySession</code>.</p>
      <Code lang="typescript">{`const session = await byoky.connect({
  // Which providers your app needs
  providers: [
    { id: 'anthropic', required: true },
    { id: 'openai', required: false },
  ],

  // Show built-in modal with extension detection + QR code fallback
  modal: true,

  // Or handle pairing yourself
  onPairingReady: (code) => showQR(code),

  // Skip extension, go straight to relay (mobile)
  useRelay: true,
});`}</Code>

      <Prop name="providers" type="ProviderRequirement[]">
        List of providers your app needs. <code>required: true</code> means connection fails if the
        user doesn&apos;t have that provider.
      </Prop>
      <Prop name="modal" type="boolean | ModalOptions">
        Show the built-in connect modal. Handles extension detection, relay fallback, and QR code
        for mobile pairing automatically.
      </Prop>
      <Prop name="onPairingReady" type="(code: string) => void">
        Called with a pairing code when no extension is detected. Display as QR or text for mobile
        wallet pairing.
      </Prop>
      <Prop name="useRelay" type="boolean">
        Skip extension detection and go directly to relay pairing.
      </Prop>

      <h3>byoky.tryReconnect()</h3>
      <p>
        Silently reconnect to an existing session. Checks persisted vault sessions, extension live
        sessions, and stored extension sessions in order. Returns <code>null</code> if nothing is
        restorable.
      </p>
      <Code lang="typescript">{`const session = await byoky.tryReconnect();
if (session) {
  // Restored — ready to make requests
}`}</Code>

      <h3>byoky.connectViaVault(options)</h3>
      <p>
        Connect via a Byoky Vault server. Works in both browser and Node.js environments.
      </p>
      <Code lang="typescript">{`const session = await byoky.connectViaVault({
  vaultUrl: 'https://vault.byoky.com',
  username: 'user@example.com',
  password: 'password',
  providers: [{ id: 'anthropic' }],
  appOrigin: 'https://myapp.com', // required in Node.js
});`}</Code>

      <h3>Utilities</h3>
      <Code lang="typescript">{`import { isExtensionInstalled, getStoreUrl } from '@byoky/sdk';

// Check if the Byoky extension is installed
if (isExtensionInstalled()) { ... }

// Get the store URL for the user's browser
const url = getStoreUrl(); // Chrome Web Store, Firefox Add-ons, etc.`}</Code>
    </Section>
  );
}

function SessionApi() {
  return (
    <Section id="session" title="Session API">
      <p>
        A <code>ByokySession</code> is returned by <code>connect()</code>,{' '}
        <code>tryReconnect()</code>, or <code>connectViaVault()</code>. It provides everything you
        need to make API calls through the wallet.
      </p>

      <h3>session.createFetch(providerId)</h3>
      <p>
        Returns a <code>fetch</code> function that proxies requests through the wallet for the given
        provider. Use it as a drop-in replacement with any provider SDK.
      </p>
      <Code lang="typescript">{`// Anthropic
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

// OpenAI
const client = new OpenAI({
  apiKey: session.sessionKey,
  fetch: session.createFetch('openai'),
});

// Or raw fetch
const fetch = session.createFetch('anthropic');
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: [...] }),
});`}</Code>

      <h3>session.createRelay(wsUrl)</h3>
      <p>
        Open a WebSocket relay channel so a backend server can make LLM calls through this session.
        See <a href="#backend-relay" style={{ color: 'var(--teal-light)' }}>Backend Relay</a>.
      </p>

      <h3>session.disconnect()</h3>
      <p>Disconnect the session. The wallet revokes all access.</p>

      <h3>session.isConnected()</h3>
      <p>Returns <code>true</code> if the session is still valid.</p>

      <h3>session.getUsage()</h3>
      <p>Get token usage stats for this session.</p>
      <Code lang="typescript">{`const usage = await session.getUsage();
// { requests: 42, inputTokens: 15000, outputTokens: 8000,
//   byProvider: { anthropic: { requests: 42, inputTokens: 15000, outputTokens: 8000 } } }`}</Code>

      <h3>session.onDisconnect(callback)</h3>
      <p>Register a callback for when the user revokes this session from the wallet.</p>

      <h3>session.onProvidersUpdated(callback)</h3>
      <p>Register a callback for when provider availability changes (e.g. credential added/removed).</p>

      <h3>Session properties</h3>
      <Code lang="typescript">{`session.sessionKey  // string — use as apiKey in provider SDKs
session.proxyUrl    // string — the proxy endpoint URL
session.providers   // Record<string, { available, authMethod, gift? }>`}</Code>
    </Section>
  );
}

function AppEcosystem() {
  return (
    <Section id="app-ecosystem" title="App Ecosystem">
      <p>
        Build apps that users install directly into their Byoky wallet. Your app runs inside a
        sandboxed iframe (extension) or WebView (mobile) &mdash; full isolation from the wallet&apos;s
        keys and storage.
      </p>

      <h3>How marketplace apps work</h3>
      <ol>
        <li>You build a web app that uses <code>@byoky/sdk</code></li>
        <li>You host it on your own infrastructure (HTTPS required)</li>
        <li>You submit it to the marketplace for review</li>
        <li>Once approved, users can install it from the App Store inside their wallet</li>
        <li>Your app runs in a sandboxed environment &mdash; keys never touch your code</li>
      </ol>

      <h3>Scaffold a new app</h3>
      <Code lang="bash">{`npx create-byoky-app my-app

# Choose a template:
#   1. AI Chat (Next.js)
#   2. Multi-Provider (Vite)
#   3. Backend Relay (Express)`}</Code>

      <h3>Submit to the marketplace</h3>
      <Code lang="bash">{`# Generate a byoky.app.json manifest
npx create-byoky-app init

# Submit for review
npx create-byoky-app submit`}</Code>
      <p>
        Or submit via the web form at{' '}
        <a href="https://byoky.com/apps/submit" style={{ color: 'var(--teal-light)' }}>
          byoky.com/apps/submit
        </a>.
      </p>

      <h3>Security model</h3>
      <ul>
        <li>Apps run in sandboxed iframes (<code>allow-scripts allow-forms</code>) or native WebViews</li>
        <li>Cross-origin isolation prevents access to wallet storage, DOM, or keys</li>
        <li>All communication happens via the SDK&apos;s <code>postMessage</code> bridge</li>
        <li>Installing an app auto-trusts its origin for the declared providers</li>
        <li>Users can disable or uninstall apps at any time</li>
      </ul>
    </Section>
  );
}

function AppManifest() {
  return (
    <Section id="manifest" title="App Manifest">
      <p>
        Every marketplace app needs a <code>byoky.app.json</code> manifest in the project root.
        Run <code>npx create-byoky-app init</code> to generate one interactively.
      </p>

      <Code lang="json">{`{
  "name": "TradeBot Pro",
  "slug": "tradebot-pro",
  "url": "https://tradebot.acme-ai.com",
  "icon": "/icon.png",
  "description": "AI-powered trading signals using your own API keys",
  "category": "trading",
  "providers": ["anthropic", "openai"],
  "author": {
    "name": "Acme AI",
    "email": "dev@acme-ai.com",
    "website": "https://acme-ai.com"
  }
}`}</Code>

      <h3>Fields</h3>
      <Prop name="name" type="string">Display name shown in the App Store and icon grid.</Prop>
      <Prop name="slug" type="string">URL-safe identifier. Must be unique across the marketplace.</Prop>
      <Prop name="url" type="string">HTTPS URL where your app is hosted. This is what loads in the sandboxed iframe.</Prop>
      <Prop name="icon" type="string">URL to your app icon. Displayed as a rounded square in the app grid.</Prop>
      <Prop name="description" type="string">Short description shown in the store listing.</Prop>
      <Prop name="category" type="string">
        One of: <code>chat</code>, <code>coding</code>, <code>trading</code>,{' '}
        <code>productivity</code>, <code>research</code>, <code>creative</code>, <code>other</code>.
      </Prop>
      <Prop name="providers" type="string[]">
        Provider IDs your app needs (e.g. <code>[&quot;anthropic&quot;, &quot;openai&quot;]</code>).
        Users approve which providers to grant on install.
      </Prop>
      <Prop name="author" type="object">
        Author info: <code>name</code> (required), <code>email</code> (required),{' '}
        <code>website</code> (optional).
      </Prop>

      <h3>Review criteria</h3>
      <ul>
        <li>App loads over HTTPS</li>
        <li>Uses <code>@byoky/sdk</code> for all LLM access</li>
        <li>Only requests providers it actually uses</li>
        <li>No obfuscated JavaScript</li>
        <li>Privacy policy exists</li>
      </ul>
    </Section>
  );
}

function BackendRelay() {
  return (
    <Section id="backend-relay" title="Backend Relay">
      <p>
        Need LLM calls from your server? The user&apos;s browser relays requests through the
        extension &mdash; your backend never sees the API key.
      </p>

      <Code lang="text">{`Backend ←WebSocket→ User's Frontend ←Extension→ LLM API`}</Code>

      <h3>Frontend</h3>
      <Code lang="typescript">{`import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic' }],
  modal: true,
});

// Open relay so your backend can make calls through this session
const relay = session.createRelay('wss://your-app.com/ws/relay');`}</Code>

      <h3>Backend (Node.js)</h3>
      <Code lang="typescript">{`import { ByokyServer } from '@byoky/sdk/server';

const byoky = new ByokyServer();

wss.on('connection', async (ws) => {
  const client = await byoky.handleConnection(ws);
  const fetch = client.createFetch('anthropic');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }],
    }),
  });
});`}</Code>
    </Section>
  );
}

function Bridge() {
  return (
    <Section id="bridge" title="Bridge (CLI / Desktop)">
      <p>
        CLI tools and desktop apps route API calls through the bridge &mdash; a local HTTP proxy
        that relays requests to the extension via native messaging.
      </p>

      <Code lang="text">{`CLI App → HTTP → Bridge (localhost:19280) → Native Messaging → Extension → LLM API`}</Code>

      <h3>Setup</h3>
      <Code lang="bash">{`npm install -g @byoky/bridge
byoky-bridge install   # register native messaging host`}</Code>

      <h3>Usage</h3>
      <p>
        Once installed, the bridge starts automatically when the extension needs it. CLI tools
        (like OpenClaw) make HTTP requests to <code>http://127.0.0.1:19280/&#123;provider&#125;/</code>,
        which the bridge forwards to the extension.
      </p>
    </Section>
  );
}

function ProvidersSection() {
  return (
    <Section id="providers" title="Supported Providers">
      <p>All providers work with <code>createFetch(providerId)</code>:</p>
      <div className="docs-providers-grid">
        {[
          ['anthropic', 'Anthropic (Claude)'],
          ['openai', 'OpenAI (GPT)'],
          ['gemini', 'Google Gemini'],
          ['mistral', 'Mistral'],
          ['cohere', 'Cohere'],
          ['xai', 'xAI (Grok)'],
          ['deepseek', 'DeepSeek'],
          ['perplexity', 'Perplexity'],
          ['groq', 'Groq'],
          ['together', 'Together AI'],
          ['fireworks', 'Fireworks AI'],
          ['openrouter', 'OpenRouter'],
          ['azure_openai', 'Azure OpenAI'],
        ].map(([id, name]) => (
          <div key={id} className="docs-provider-row">
            <code>{id}</code>
            <span>{name}</span>
          </div>
        ))}
      </div>

      <h3>Cross-provider routing</h3>
      <p>
        Users can route your app&apos;s requests through a different provider than what your code
        targets. For example, your app calls <code>anthropic</code> but the user routes it through
        <code>openai</code> &mdash; the wallet transparently translates request/response bodies and
        SSE streams. Your code doesn&apos;t need to change.
      </p>
    </Section>
  );
}

/* ─── Components ───────────────────────────────── */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      <div className="docs-section-body">{children}</div>
    </section>
  );
}

function Code({ lang, children }: { lang: string; children: string }) {
  return (
    <div className="docs-code">
      {lang !== 'text' && <div className="docs-code-lang">{lang}</div>}
      <pre><code>{children}</code></pre>
    </div>
  );
}

function Prop({ name, type, children }: { name: string; type: string; children: React.ReactNode }) {
  return (
    <div className="docs-prop">
      <div className="docs-prop-header">
        <code className="docs-prop-name">{name}</code>
        <span className="docs-prop-type">{type}</span>
      </div>
      <div className="docs-prop-desc">{children}</div>
    </div>
  );
}

/* ─── Styles ───────────────────────────────────── */

const docsStyles = `
.docs-layout {
  display: flex;
  max-width: 1100px;
  margin: 0 auto;
  padding: 60px 20px 80px;
  gap: 48px;
}

.docs-nav {
  position: sticky;
  top: 80px;
  width: 180px;
  flex-shrink: 0;
  align-self: flex-start;
}

.docs-nav-title {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--text);
}

.docs-nav-link {
  display: block;
  padding: 6px 0;
  font-size: 14px;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s;
}

.docs-nav-link:hover,
.docs-nav-link.active {
  color: var(--teal-light);
}

.docs-content {
  flex: 1;
  min-width: 0;
}

.docs-section {
  margin-bottom: 56px;
  scroll-margin-top: 80px;
}

.docs-section h2 {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--text);
}

.docs-section h3 {
  font-size: 17px;
  font-weight: 600;
  margin-top: 28px;
  margin-bottom: 10px;
  color: var(--text);
}

.docs-section-body {
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.7;
}

.docs-section-body p {
  margin-bottom: 12px;
}

.docs-section-body code {
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--teal-light);
}

.docs-section-body ul,
.docs-section-body ol {
  padding-left: 20px;
  margin: 8px 0 16px;
}

.docs-section-body li {
  margin-bottom: 6px;
}

.docs-code {
  position: relative;
  background: #07070f;
  border: 1px solid var(--border);
  border-radius: 10px;
  margin: 14px 0 20px;
  overflow-x: auto;
}

.docs-code-lang {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.docs-code pre {
  margin: 0;
  padding: 18px 20px;
  font-family: 'Fira Code', 'Consolas', 'SF Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text);
}

.docs-code code {
  background: none !important;
  padding: 0 !important;
  color: inherit !important;
  font-size: inherit;
}

.docs-prop {
  border-left: 2px solid var(--border);
  padding: 8px 0 8px 14px;
  margin: 8px 0;
}

.docs-prop-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.docs-prop-name {
  font-weight: 600;
  font-size: 14px;
}

.docs-prop-type {
  font-size: 12px;
  color: var(--text-muted);
  font-family: 'Fira Code', monospace;
}

.docs-prop-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.docs-providers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 6px;
  margin: 12px 0 20px;
}

.docs-provider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-card);
  border-radius: 8px;
  font-size: 14px;
}

.docs-provider-row code {
  font-size: 12px;
  color: var(--teal-light);
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
}

.docs-provider-row span {
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .docs-layout {
    flex-direction: column;
    gap: 24px;
  }
  .docs-nav {
    position: static;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .docs-nav-title {
    width: 100%;
  }
}
`;
