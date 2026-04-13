'use client';

import { useState } from 'react';

/* ─── Navigation structure ────────────────────── */

const categories = [
  {
    label: 'Getting Started',
    items: [
      { id: 'overview', label: 'Overview' },
      { id: 'installation', label: 'Installation' },
      { id: 'quickstart', label: 'Quickstart' },
    ],
  },
  {
    label: 'SDK Reference',
    items: [
      { id: 'sdk', label: 'Byoky Client' },
      { id: 'session', label: 'Session API' },
      { id: 'providers', label: 'Providers' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { id: 'backend-relay', label: 'Backend Relay' },
      { id: 'bridge', label: 'Bridge (CLI)' },
      { id: 'token-gifts', label: 'Token Gifts' },
      { id: 'token-marketplace', label: 'Token Marketplace' },
      { id: 'cross-provider', label: 'Cross-Provider Routing' },
    ],
  },
  {
    label: 'App Ecosystem',
    items: [
      { id: 'app-ecosystem', label: 'Overview' },
      { id: 'manifest', label: 'App Manifest' },
    ],
  },
];

/* ─── Page ────────────────────────────────────── */

export default function Docs() {
  const [active, setActive] = useState('overview');

  return (
    <div className="docs-layout">
      <nav className="docs-nav">
        {categories.map((cat) => (
          <div key={cat.label} className="docs-nav-group">
            <div className="docs-nav-category">{cat.label}</div>
            {cat.items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`docs-nav-link ${active === item.id ? 'active' : ''}`}
                onClick={() => setActive(item.id)}
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <main className="docs-content">
        <div className="docs-hero">
          <span className="docs-hero-label">Documentation</span>
          <h1>Byoky Docs</h1>
          <p>
            Everything you need to integrate Byoky into your app &mdash; from
            quickstart to API reference.
          </p>
        </div>

        <DocsCards />

        <Overview />
        <Installation />
        <Quickstart />
        <SdkReference />
        <SessionApi />
        <ProvidersSection />
        <BackendRelay />
        <Bridge />
        <TokenGifts />
        <TokenMarketplaceSection />
        <CrossProviderRouting />
        <AppEcosystem />
        <AppManifest />
      </main>

      <style>{docsStyles}</style>
    </div>
  );
}

/* ─── Cards grid ──────────────────────────────── */

function DocsCards() {
  return (
    <div className="docs-cards-area">
      {categories.map((cat) => (
        <div key={cat.label}>
          <h3 className="docs-cards-heading">{cat.label}</h3>
          <div className="docs-cards-grid">
            {cat.items.map((item) => (
              <a key={item.id} href={`#${item.id}`} className="docs-card">
                {item.label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Sections ─────────────────────────────────── */

function Overview() {
  return (
    <Section id="overview" title="Overview">
      <p>
        Byoky lets users store their AI API keys in an encrypted wallet. Your app never sees the keys
        &mdash; it gets a proxied session that routes requests through the wallet.
      </p>

      <h3>How it works</h3>
      <Code lang="text">{`Your App → SDK (createFetch) → Content Script → Extension → LLM API
                                                    ↑
                                          Keys stay here. Always.`}</Code>

      <p>
        Two lines changed. Full API compatibility. Streaming, file uploads, and vision all work.
        Sessions auto-reconnect if the extension restarts.
      </p>
    </Section>
  );
}

function Installation() {
  return (
    <Section id="installation" title="Installation">
      <h3>Install the SDK</h3>
      <Code lang="bash">{`npm install @byoky/sdk`}</Code>

      <h3>Scaffold a new project</h3>
      <Code lang="bash">{`npx create-byoky-app my-app

# Choose a template:
#   1. AI Chat (Next.js)
#   2. Multi-Provider (Vite)
#   3. Backend Relay (Express)`}</Code>

      <h3>User wallets</h3>
      <p>Your users need one of these installed:</p>
      <ul>
        <li><a href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon" style={{ color: 'var(--teal-light)' }}>Chrome Extension</a></li>
        <li><a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" style={{ color: 'var(--teal-light)' }}>Firefox Extension</a></li>
        <li><a href="https://apps.apple.com/app/byoky/id6760779919" style={{ color: 'var(--teal-light)' }}>iOS App</a> (wallet + Safari extension)</li>
        <li><a href="https://play.google.com/store/apps/details?id=com.byoky.app" style={{ color: 'var(--teal-light)' }}>Android App</a> (pair via QR or relay)</li>
      </ul>
    </Section>
  );
}

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart">
      <p>Connect and make your first request in under a minute:</p>
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
        That&apos;s it. Full API compatibility &mdash; streaming, file uploads, and vision all work
        unchanged.
      </p>
    </Section>
  );
}

function SdkReference() {
  return (
    <Section id="sdk" title="Byoky Client">
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
session.providers   // Record<string, { available, authMethod }>`}</Code>
    </Section>
  );
}

function ProvidersSection() {
  return (
    <Section id="providers" title="Providers">
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

function TokenGifts() {
  return (
    <Section id="token-gifts" title="Token Gifts">
      <p>
        Share token access without sharing your API key. The sender&apos;s wallet proxies all
        requests &mdash; the key never leaves the extension.
      </p>

      <Code lang="text">{`Sender's Extension ←WebSocket→ Relay Server ←WebSocket→ Recipient's Extension`}</Code>

      <h3>Create a gift</h3>
      <ol>
        <li>Open the wallet &rarr; select a credential &rarr; click &quot;Gift&quot;</li>
        <li>Set a token budget and expiry</li>
        <li>Share the generated gift link</li>
      </ol>

      <h3>Redeem a gift</h3>
      <ol>
        <li>Open the wallet &rarr; click &quot;Redeem Gift&quot;</li>
        <li>Paste the gift link &rarr; accept</li>
      </ol>

      <h3>Self-host the relay</h3>
      <Code lang="bash">{`npm install -g @byoky/relay
byoky-relay  # default port 8787`}</Code>

      <p>
        The recipient never receives your API key. Every request is relayed through the
        sender&apos;s running extension, which enforces the token budget and can revoke access
        at any time.
      </p>
    </Section>
  );
}

function TokenMarketplaceSection() {
  return (
    <Section id="token-marketplace" title="Token Marketplace">
      <p>
        The{' '}
        <a href="/marketplace" style={{ color: 'var(--teal-light)' }}>
          Token Marketplace
        </a>{' '}
        is a public board where users share free token gifts with the community.
      </p>

      <h3>How it works</h3>
      <ol>
        <li>Create a gift in your wallet (extension or mobile)</li>
        <li>Check &quot;List on Token Marketplace&quot;</li>
        <li>Add a display name (or stay anonymous)</li>
        <li>Your gift appears on the marketplace for anyone to redeem</li>
      </ol>

      <h3>What users see</h3>
      <ul>
        <li><strong>Online/offline status</strong> &mdash; green dot if the gifter&apos;s wallet is online (gift is usable), red if offline</li>
        <li><strong>Tokens remaining</strong> &mdash; progress bar showing how much budget is left</li>
        <li><strong>Expiry countdown</strong> &mdash; time until the gift expires</li>
        <li><strong>Provider</strong> &mdash; which LLM provider the tokens are for</li>
      </ul>

      <h3>API endpoints</h3>
      <p>
        The marketplace runs at <code>marketplace.byoky.com</code> with these endpoints:
      </p>
      <Code lang="text">{`GET    /gifts              — list active + expired gifts
GET    /gifts/:id/redeem   — get gift link for redemption
POST   /gifts              — list a gift publicly (called by wallet)
DELETE /gifts/:id          — unlist a gift
PATCH  /gifts/:id/usage    — update token usage
POST   /gifts/:id/heartbeat — online status ping`}</Code>
    </Section>
  );
}

function CrossProviderRouting() {
  return (
    <Section id="cross-provider" title="Cross-Provider Routing">
      <p>
        Users can route your app&apos;s requests through a different provider than what your code
        targets. For example, your app calls <code>anthropic</code> but the user routes it through{' '}
        <code>openai</code> &mdash; the wallet transparently translates request/response bodies and
        SSE streams.
      </p>

      <Code lang="text">{`Your App (Anthropic SDK) → Wallet (translates) → OpenAI API
                                  ↕
              Anthropic ↔ OpenAI ↔ Gemini ↔ Cohere`}</Code>

      <h3>How it works</h3>
      <ol>
        <li>User creates groups in their wallet (e.g. &quot;Claude&quot;, &quot;GPT&quot;)</li>
        <li>Each group is pinned to a specific credential and provider</li>
        <li>Dragging an app between groups reroutes its traffic</li>
        <li>Request bodies, response bodies, and SSE streams are translated on the fly</li>
      </ol>

      <p>
        <strong>No code changes required.</strong> Your app keeps calling its preferred SDK; the
        wallet handles the translation. Live sessions reroute automatically.
      </p>
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
  --docs-bg: #0e0e1a;
  --docs-bg-card: #161626;
  --docs-bg-elevated: #1c1c30;
  --docs-border: #252540;
  --docs-text: #ededf4;
  --docs-text-secondary: #9494b0;
  --docs-text-muted: #5a5a78;

  display: flex;
  max-width: 1100px;
  margin: 0 auto;
  padding: 120px 20px 80px;
  gap: 48px;
}

/* ── Sidebar ── */

.docs-nav {
  position: sticky;
  top: 80px;
  width: 200px;
  flex-shrink: 0;
  align-self: flex-start;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
}

.docs-nav-group {
  margin-bottom: 24px;
}

.docs-nav-category {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--docs-text-muted);
  margin-bottom: 8px;
  padding-left: 2px;
}

.docs-nav-link {
  display: block;
  padding: 5px 0 5px 2px;
  font-size: 14px;
  color: var(--docs-text-secondary);
  text-decoration: none;
  transition: color 0.15s;
  border-left: 2px solid transparent;
  padding-left: 12px;
  margin-left: -2px;
}

.docs-nav-link:hover {
  color: var(--docs-text);
}

.docs-nav-link.active {
  color: var(--teal-light);
  border-left-color: var(--teal);
}

/* ── Content ── */

.docs-content {
  flex: 1;
  min-width: 0;
}

/* ── Hero ── */

.docs-hero {
  margin-bottom: 48px;
  padding-bottom: 40px;
  border-bottom: 1px solid var(--docs-border);
}

.docs-hero-label {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--teal);
  margin-bottom: 12px;
}

.docs-hero h1 {
  font-size: 40px;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: -0.02em;
}

.docs-hero p {
  font-size: 17px;
  color: var(--docs-text-secondary);
  line-height: 1.6;
  max-width: 560px;
}

/* ── Cards ── */

.docs-cards-area {
  margin-bottom: 56px;
  padding-bottom: 48px;
  border-bottom: 1px solid var(--docs-border);
}

.docs-cards-area > div + div {
  margin-top: 32px;
}

.docs-cards-heading {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--docs-text);
}

.docs-cards-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.docs-card {
  display: block;
  padding: 16px 20px;
  border-radius: 10px;
  border: 1px solid var(--docs-border);
  background: var(--docs-bg-card);
  color: var(--docs-text);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s, transform 0.2s;
}

.docs-card:hover {
  border-color: var(--teal);
  background: var(--docs-bg-elevated);
  transform: translateY(-1px);
}

/* ── Sections ── */

.docs-section {
  margin-bottom: 56px;
  scroll-margin-top: 80px;
}

.docs-section h2 {
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 16px;
  color: var(--docs-text);
}

.docs-section h3 {
  font-size: 17px;
  font-weight: 600;
  margin-top: 28px;
  margin-bottom: 10px;
  color: var(--docs-text);
}

.docs-section-body {
  color: var(--docs-text-secondary);
  font-size: 15px;
  line-height: 1.7;
}

.docs-section-body p {
  margin-bottom: 12px;
}

.docs-section-body code {
  background: var(--docs-bg-elevated);
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

/* ── Code blocks ── */

.docs-code {
  position: relative;
  background: var(--docs-bg-card);
  border: 1px solid var(--docs-border);
  border-radius: 10px;
  margin: 14px 0 20px;
  overflow-x: auto;
}

.docs-code-lang {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  color: var(--docs-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.docs-code pre {
  margin: 0;
  padding: 18px 20px;
  font-family: 'Fira Code', 'Consolas', 'SF Mono', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--docs-text);
}

.docs-code code {
  background: none !important;
  padding: 0 !important;
  color: inherit !important;
  font-size: inherit;
}

/* ── Props ── */

.docs-prop {
  border-left: 2px solid var(--docs-border);
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
  color: var(--docs-text-muted);
  font-family: 'Fira Code', monospace;
}

.docs-prop-desc {
  font-size: 14px;
  color: var(--docs-text-secondary);
  line-height: 1.5;
}

/* ── Providers grid ── */

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
  background: var(--docs-bg-card);
  border-radius: 8px;
  font-size: 14px;
}

.docs-provider-row code {
  font-size: 12px;
  color: var(--teal-light);
  background: var(--docs-bg-elevated);
  padding: 2px 6px;
  border-radius: 4px;
}

.docs-provider-row span {
  color: var(--docs-text-secondary);
}

/* ── Responsive ── */

@media (max-width: 768px) {
  .docs-layout {
    flex-direction: column;
    gap: 24px;
    padding-top: 120px;
  }
  .docs-nav {
    position: static;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    max-height: none;
  }
  .docs-nav-group {
    margin-bottom: 12px;
  }
  .docs-nav-link {
    border-left: none;
    padding-left: 0;
    margin-left: 0;
  }
  .docs-hero h1 {
    font-size: 30px;
  }
  .docs-cards-grid {
    grid-template-columns: 1fr;
  }
}
`;
