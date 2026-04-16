'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { GitHubStarButton } from '../components/GitHubStarButton';
import { DocsPlayground } from './DocsPlayground';
import type { PlaygroundTab } from '../demo/components/Playground';

/* ─── Navigation structure ────────────────────── */

const AI_PROMPT = `You are helping me build an app on Byoky (https://byoky.com).

# What Byoky is

Byoky is a BYOK ("bring your own key") wallet for AI. Users store their API keys for providers like Anthropic, OpenAI, Gemini, etc. in an encrypted browser extension or mobile app. My app never sees the keys — it calls the user's wallet through a proxied session.

# Setup

\`\`\`bash
npm install @byoky/sdk
# or scaffold a full project:
npx create-byoky-app my-app
\`\`\`

# Quickstart (browser app)

\`\`\`ts
import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true, // built-in connect UI: extension detection + QR for mobile wallets
});

// Use the native provider SDK — just pass Byoky's fetch and sessionKey
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const msg = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
\`\`\`

# Session API

- \`session.createFetch(providerId)\` — drop-in \`fetch\` for any provider SDK. Streaming, vision, and file uploads all work unchanged.
- \`session.createRelay(wsUrl)\` — open a WebSocket so a backend server can make LLM calls through this session.
- \`session.getUsage()\` — returns { requests, inputTokens, outputTokens, byProvider }.
- \`session.onDisconnect(cb)\` / \`session.onProvidersUpdated(cb)\` — lifecycle callbacks.
- \`session.sessionKey\`, \`session.proxyUrl\`, \`session.providers\` — session properties.
- \`byoky.tryReconnect()\` — silently restore a previous session (returns null if nothing to restore).
- \`byoky.connectViaVault({ vaultUrl, username, password, providers, appOrigin })\` — connect via a Byoky Vault server (works in Node.js too; \`appOrigin\` required server-side).

# Supported providers (use these IDs with createFetch)

anthropic, openai, gemini, mistral, cohere, xai, deepseek, perplexity, groq, together, fireworks, openrouter, azure_openai

# Backend relay (for server-side LLM calls)

Frontend opens \`session.createRelay('wss://your-app.com/ws/relay')\`. Backend uses \`ByokyServer\` from \`@byoky/sdk/server\` and calls \`client.createFetch(id)\` the same way. Your backend never sees the API key — all traffic relays through the user's browser → extension → LLM.

# Rules

- Use native provider SDKs (Anthropic, OpenAI, Google GenAI, etc.). Pass \`session.createFetch(id)\` as \`fetch\` and \`session.sessionKey\` as \`apiKey\`.
- Never collect or prompt the user for an API key — Byoky replaces that entirely.
- Users install one of: Chrome/Firefox extension, iOS app, or Android app. The SDK's \`modal: true\` handles extension detection, relay fallback, and QR pairing for mobile automatically.
- Full docs: https://byoky.com/docs

Now help me build: `;

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
    label: 'Features',
    items: [
      { id: 'streaming', label: 'Streaming' },
      { id: 'tool-use', label: 'Tool Use' },
      { id: 'structured-output', label: 'Structured Output' },
      { id: 'vision', label: 'Vision' },
      { id: 'errors', label: 'Error Handling' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { id: 'backend-relay', label: 'Backend Relay' },
      { id: 'bridge', label: 'Bridge (CLI)' },
      { id: 'token-gifts', label: 'Token Gifts' },
      { id: 'token-pool', label: 'Token Pool' },
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

const TryLiveContext = createContext<((tab: PlaygroundTab) => void) | null>(null);

export default function Docs() {
  const [active, setActive] = useState('overview');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<PlaygroundTab | undefined>(undefined);

  const openDrawer = useCallback((tab: PlaygroundTab) => {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <TryLiveContext.Provider value={openDrawer}>
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
          <GitHubStarButton repo="MichaelLod/byoky" />
          <p>
            Everything you need to integrate Byoky into your app &mdash; from
            quickstart to API reference.
          </p>
          <AiPromptCTA />
        </div>

        <DocsCards />

        <Overview />
        <Installation />
        <Quickstart />
        <SdkReference />
        <SessionApi />
        <ProvidersSection />
        <Streaming />
        <ToolUse />
        <StructuredOutputSection />
        <Vision />
        <Errors />
        <BackendRelay />
        <Bridge />
        <TokenGifts />
        <TokenPoolSection />
        <CrossProviderRouting />
        <AppEcosystem />
        <AppManifest />
      </main>

      <style>{docsStyles}</style>
    </div>
    <DocsPlayground open={drawerOpen} tab={drawerTab} onClose={closeDrawer} />
    </TryLiveContext.Provider>
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
        <li><a href="https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon" style={{ color: 'var(--teal-dark)' }}>Chrome Extension</a></li>
        <li><a href="https://addons.mozilla.org/en-US/firefox/addon/byoky/" style={{ color: 'var(--teal-dark)' }}>Firefox Extension</a></li>
        <li><a href="https://apps.apple.com/app/byoky/id6760779919" style={{ color: 'var(--teal-dark)' }}>iOS App</a> (wallet + Safari extension)</li>
        <li><a href="https://play.google.com/store/apps/details?id=com.byoky.app" style={{ color: 'var(--teal-dark)' }}>Android App</a> (pair via QR or relay)</li>
      </ul>
    </Section>
  );
}

function Quickstart() {
  return (
    <Section id="quickstart" title="Quickstart">
      <p>Connect and make your first request in under a minute:</p>
      <Code lang="typescript" demo="chat">{`import Anthropic from '@anthropic-ai/sdk';
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
      <Code lang="typescript" demo="session">{`const session = await byoky.connect({
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
      <Code lang="typescript" demo="session">{`const session = await byoky.tryReconnect();
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
      <Code lang="typescript" demo="chat">{`// Anthropic
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
        See <a href="#backend-relay" style={{ color: 'var(--teal-dark)' }}>Backend Relay</a>.
      </p>

      <h3>session.disconnect()</h3>
      <p>Disconnect the session. The wallet revokes all access.</p>

      <h3>session.isConnected()</h3>
      <p>Returns <code>true</code> if the session is still valid.</p>

      <h3>session.getUsage()</h3>
      <p>Get token usage stats for this session.</p>
      <Code lang="typescript" demo="session">{`interface SessionUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  byProvider: Record<string, {
    requests: number;
    inputTokens: number;
    outputTokens: number;
  }>;
}

const usage = await session.getUsage();
// { requests: 42, inputTokens: 15000, outputTokens: 8000,
//   byProvider: { anthropic: { requests: 42, inputTokens: 15000, outputTokens: 8000 } } }`}</Code>

      <h3>session.onDisconnect(callback)</h3>
      <p>Register a callback for when the user revokes this session from the wallet.</p>

      <h3>session.onProvidersUpdated(callback)</h3>
      <p>
        Register a callback for when provider availability changes &mdash; e.g. the user adds a
        credential, revokes one, or swaps the provider group bound to your app (cross-provider
        routing). The callback receives the new <code>session.providers</code> record.
      </p>

      <h3>Session properties</h3>
      <Code lang="typescript">{`session.sessionKey  // string — use as apiKey in provider SDKs
session.proxyUrl    // string — the proxy endpoint URL
session.providers   // Record<ProviderId, ProviderStatus>

interface ProviderStatus {
  // true: the wallet has a working credential (or gift) for this provider
  //       and will hit the provider directly.
  // false: your app can still call createFetch(id) — the wallet may route
  //        it through another provider via cross-provider translation.
  available: boolean;

  // How the credential authenticates upstream.
  authMethod: 'api_key' | 'oauth';

  // Present and true when the credential came from a redeemed Token Gift.
  // The gifter's wallet proxies every request and enforces the token budget.
  gift?: boolean;
}`}</Code>
      <p>
        Check <code>providers[id].available</code> before assuming direct access. A provider marked{' '}
        <code>available: false</code> may still work if the user has set up cross-provider routing.
        See <a href="#cross-provider" style={{ color: 'var(--teal-dark)' }}>Cross-Provider Routing</a>.
      </p>
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

function Streaming() {
  return (
    <Section id="streaming" title="Streaming">
      <p>
        Every provider&apos;s streaming format works unchanged through <code>createFetch</code>. The
        proxy forwards response chunks over a persistent port &mdash; no buffering, no polling, no
        special flags on your end.
      </p>

      <h3>With a provider SDK</h3>
      <p>The easiest path &mdash; the SDK handles SSE parsing for you:</p>
      <Code lang="typescript">{`import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Write a haiku.' }],
});

for await (const event of stream) {
  if (event.type === 'content_block_delta'
    && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}`}</Code>

      <h3>With raw fetch</h3>
      <p>
        If you prefer to call the HTTP API directly, parse SSE from the returned{' '}
        <code>response.body</code>:
      </p>
      <Code lang="typescript">{`const fetch = session.createFetch('anthropic');
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\\n');
  buf = lines.pop() || '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);
    if (data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'content_block_delta') {
      process.stdout.write(event.delta.text);
    }
  }
}`}</Code>
      <p>
        OpenAI-compatible providers (OpenAI, Groq, DeepSeek, xAI, Mistral, Together, Fireworks,
        Perplexity, OpenRouter) stream <code>choices[0].delta.content</code> in the same SSE
        envelope. Gemini uses <code>streamGenerateContent</code>.
      </p>
    </Section>
  );
}

function ToolUse() {
  return (
    <Section id="tool-use" title="Tool Use">
      <p>
        Tool use (a.k.a. function calling) works unchanged through the proxy. Define tools, let the
        model call them, execute locally, feed results back &mdash; loop until the model stops
        asking for tools.
      </p>

      <h3>Anthropic format</h3>
      <Code lang="typescript">{`const fetch = session.createFetch('anthropic');
const tools = [{
  name: 'get_weather',
  description: 'Get current weather for a city',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
  },
}];

const messages: Array<Record<string, unknown>> = [
  { role: 'user', content: "What's the weather in Tokyo?" },
];

for (let round = 0; round < 5; round++) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      tools,
      messages,
    }),
  });
  const data = await res.json();
  const toolCalls = data.content.filter((b: any) => b.type === 'tool_use');
  if (toolCalls.length === 0) {
    console.log(data.content.find((b: any) => b.type === 'text')?.text);
    break;
  }
  const results = toolCalls.map((tc: any) => ({
    type: 'tool_result',
    tool_use_id: tc.id,
    content: JSON.stringify(runTool(tc.name, tc.input)),
  }));
  messages.push({ role: 'assistant', content: data.content });
  messages.push({ role: 'user', content: results });
}`}</Code>

      <h3>OpenAI-compatible format</h3>
      <p>
        Used by OpenAI, Groq, DeepSeek, xAI, Mistral, Together, Fireworks, Perplexity, and
        OpenRouter. Tools are wrapped in <code>{`{ type: 'function', function: { ... } }`}</code>,
        and the model returns <code>choices[0].message.tool_calls</code>:
      </p>
      <Code lang="typescript">{`const fetch = session.createFetch('openai');
const tools = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
}];

const messages: Array<Record<string, unknown>> = [
  { role: 'user', content: "What's the weather in Tokyo?" },
];

for (let round = 0; round < 5; round++) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', tools, messages }),
  });
  const data = await res.json();
  const msg = data.choices[0].message;
  if (!msg.tool_calls?.length) { console.log(msg.content); break; }
  messages.push(msg);
  for (const tc of msg.tool_calls) {
    const args = JSON.parse(tc.function.arguments);
    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(runTool(tc.function.name, args)),
    });
  }
}`}</Code>
    </Section>
  );
}

function StructuredOutputSection() {
  return (
    <Section id="structured-output" title="Structured Output">
      <p>
        Get typed JSON back from any OpenAI-compatible provider, plus Anthropic. Two modes exist:
        OpenAI&apos;s strict <code>json_schema</code> (enforced by the model), and the looser{' '}
        <code>json_object</code> mode supported by most OpenAI-compatible providers.
      </p>

      <h3>OpenAI strict schema</h3>
      <Code lang="typescript">{`const fetch = session.createFetch('openai');
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Extract: "Jane, jane@acme.co, Acme"' }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'contact',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            name:    { type: 'string' },
            email:   { type: 'string' },
            company: { type: 'string' },
          },
          required: ['name', 'email', 'company'],
          additionalProperties: false,
        },
      },
    },
  }),
});

const data = await res.json();
const contact = JSON.parse(data.choices[0].message.content);`}</Code>

      <h3>json_object (Groq, DeepSeek, Mistral, Together, Fireworks, OpenRouter, xAI)</h3>
      <Code lang="typescript">{`body: JSON.stringify({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: 'Return JSON with keys name, email.' }],
  response_format: { type: 'json_object' },
});`}</Code>

      <h3>Anthropic</h3>
      <p>
        Claude doesn&apos;t have a <code>response_format</code> field. Prompt it to return JSON and
        parse the text block &mdash; or use tool use with a single tool as the forced schema:
      </p>
      <Code lang="typescript">{`const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: 'Return ONLY JSON: { "name": "...", "email": "..." } for: "Jane, jane@acme.co"',
    }],
  }),
});
const data = await res.json();
const json = JSON.parse(data.content[0].text.match(/\\{[\\s\\S]*\\}/)![0]);`}</Code>
    </Section>
  );
}

function Vision() {
  return (
    <Section id="vision" title="Vision">
      <p>
        Image inputs work through the proxy just like text. Anthropic, OpenAI, and Gemini each take
        a different wire format &mdash; the payload pattern below matches what ships in the{' '}
        <a href="/demo" style={{ color: 'var(--teal-dark)' }}>demo</a>.
      </p>

      <h3>Convert a File to base64</h3>
      <Code lang="typescript">{`async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}`}</Code>

      <h3>Anthropic</h3>
      <Code lang="typescript">{`body: JSON.stringify({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: file.type, data: base64 },
      },
      { type: 'text', text: 'What is in this image?' },
    ],
  }],
});`}</Code>

      <h3>OpenAI</h3>
      <Code lang="typescript">{`body: JSON.stringify({
  model: 'gpt-4o',
  messages: [{
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: { url: \`data:\${file.type};base64,\${base64}\` },
      },
      { type: 'text', text: 'What is in this image?' },
    ],
  }],
});`}</Code>

      <h3>Gemini</h3>
      <Code lang="typescript">{`body: JSON.stringify({
  contents: [{
    role: 'user',
    parts: [
      { inline_data: { mime_type: file.type, data: base64 } },
      { text: 'What is in this image?' },
    ],
  }],
});`}</Code>
    </Section>
  );
}

function Errors() {
  return (
    <Section id="errors" title="Error Handling">
      <p>
        Errors from upstream providers surface with their original HTTP status and body &mdash; so{' '}
        <code>response.status</code> and the usual <code>{`{ error: { message } }`}</code> body
        shape work the same as hitting the provider directly.
      </p>

      <p>
        The proxy layer adds its own error codes on top, signalled with an HTTP status and an{' '}
        <code>error.code</code> field in the JSON body:
      </p>

      <div className="docs-providers-grid">
        {[
          ['WALLET_NOT_INSTALLED', 'Extension/app not detected during connect()'],
          ['USER_REJECTED', 'User dismissed the connect modal'],
          ['PROVIDER_UNAVAILABLE', 'No credential and no routing group for this provider'],
          ['SESSION_EXPIRED', 'Session was revoked or timed out — call connect() again'],
          ['RATE_LIMITED', 'Upstream provider rate limit (HTTP 429)'],
          ['QUOTA_EXCEEDED', 'Gift budget or wallet-imposed limit hit (HTTP 429)'],
          ['INVALID_KEY', 'Stored credential rejected by provider'],
          ['TOKEN_EXPIRED', 'OAuth token expired and refresh failed'],
          ['PROXY_ERROR', 'Generic proxy failure — retryable'],
          ['RELAY_CONNECTION_FAILED', 'Backend relay could not reach the browser'],
          ['RELAY_DISCONNECTED', 'Relay peer disconnected mid-request'],
        ].map(([code, desc]) => (
          <div key={code} className="docs-provider-row">
            <code>{code}</code>
            <span>{desc}</span>
          </div>
        ))}
      </div>

      <h3>Handling quota errors</h3>
      <p>
        When a user redeems a Token Gift with a limited budget, or the wallet enforces per-session
        limits, requests fail with HTTP 429 and <code>code: 'QUOTA_EXCEEDED'</code>. Surface this to
        the user rather than retrying:
      </p>
      <Code lang="typescript">{`const fetch = session.createFetch('anthropic');
const res = await fetch(url, { method: 'POST', headers, body });

if (!res.ok) {
  const body = await res.json().catch(() => null);
  const code = body?.error?.code;

  if (res.status === 429 && code === 'QUOTA_EXCEEDED') {
    showQuotaExhaustedUI();
    return;
  }
  if (code === 'SESSION_EXPIRED') {
    await byoky.connect({ providers: [...], modal: true });
    return;
  }
  throw new Error(body?.error?.message ?? \`HTTP \${res.status}\`);
}`}</Code>

      <h3>Listening for session lifecycle</h3>
      <Code lang="typescript">{`session.onDisconnect(() => {
  // The user revoked access from the wallet, or the session expired.
  // Prompt them to reconnect before the next request.
  showReconnectBanner();
});

session.onProvidersUpdated((providers) => {
  // A credential was added/removed, or the user changed routing.
  // Refresh your UI's model picker.
  setAvailable(Object.entries(providers)
    .filter(([, v]) => v.available)
    .map(([id]) => id));
});`}</Code>
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
      <Code lang="typescript" demo="relay">{`import { Byoky } from '@byoky/sdk';

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

function TokenPoolSection() {
  return (
    <Section id="token-pool" title="Token Pool">
      <p>
        The{' '}
        <a href="/token-pool" style={{ color: 'var(--teal-dark)' }}>
          Token Pool
        </a>{' '}
        is a public board where users share free token gifts with the community.
      </p>

      <h3>How it works</h3>
      <ol>
        <li>Create a gift in your wallet (extension or mobile)</li>
        <li>Check &quot;List on Token Pool&quot;</li>
        <li>Add a display name (or stay anonymous)</li>
        <li>Your gift appears on the token pool for anyone to redeem</li>
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

      <h3>Hosting requirements</h3>
      <p>
        Because your app loads inside an iframe in the Byoky extension, your server must allow iframe
        embedding. Do <em>not</em> set <code>X-Frame-Options: DENY</code> or <code>SAMEORIGIN</code>,
        and either omit <code>Content-Security-Policy</code> <code>frame-ancestors</code> or set it
        to something permissive:
      </p>
      <Code lang="http">{`Content-Security-Policy: frame-ancestors *`}</Code>
      <p>
        We verify this automatically at submission time and reject apps that would fail to load.
      </p>
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
        <li>App URL allows iframe embedding (no <code>X-Frame-Options: DENY</code> / <code>SAMEORIGIN</code>, no restrictive <code>frame-ancestors</code>)</li>
        <li>Uses <code>@byoky/sdk</code> for all LLM access</li>
        <li>Only requests providers it actually uses</li>
        <li>No obfuscated JavaScript</li>
        <li>Privacy policy exists</li>
      </ul>
    </Section>
  );
}

/* ─── Components ───────────────────────────────── */

function AiPromptCTA() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — fall through silently */
    }
  };

  return (
    <div className="docs-ai-cta">
      <div className="docs-ai-cta-text">
        <div className="docs-ai-cta-title">
          <span className="docs-ai-cta-spark" aria-hidden>✦</span>
          Building with an AI assistant?
        </div>
        <div className="docs-ai-cta-subtitle">
          Copy the setup prompt, paste into Claude, ChatGPT, or Cursor, and start building
          with a Byoky-aware model.
        </div>
      </div>
      <button
        type="button"
        className={`docs-ai-cta-btn ${copied ? 'copied' : ''}`}
        onClick={copy}
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Copy prompt for AI
          </>
        )}
      </button>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="docs-section">
      <h2>{title}</h2>
      <div className="docs-section-body">{children}</div>
    </section>
  );
}

function highlightCode(code: string, lang: string): string {
  if (lang === 'text') return code.replace(/</g, '&lt;');

  let html = code.replace(/</g, '&lt;');

  // Two rules make these regex passes safe from self-mangling:
  //   1. Emit via data-tk="…" (not class="tk-…") so the `class` keyword regex
  //      can't match its own output attributes.
  //   2. Run the string pass FIRST in every lang so later passes don't
  //      accidentally match the quoted attribute values we just emitted
  //      (e.g. `"comment"` in `data-tk="comment"`).
  if (lang === 'bash') {
    html = html.replace(/(&#39;[^&#]*&#39;|"[^"]*")/g, '<span data-tk="string">$1</span>');
    html = html.replace(/(#[^\n<]*)/g, '<span data-tk="comment">$1</span>');
    html = html.replace(/^(\$)/gm, '<span data-tk="keyword">$1</span>');
    html = html.replace(/(\s)(--?\w[\w-]*)/g, '$1<span data-tk="value">$2</span>');
    html = html.replace(/(✓)/g, '<span data-tk="value">$1</span>');
    return html;
  }

  // TypeScript / JavaScript
  html = html.replace(/(&#39;[^&#]*&#39;|'[^']*'|"[^"]*"|`[^`]*`)/g, '<span data-tk="string">$1</span>');
  html = html.replace(/(\/\/[^\n<]*)/g, '<span data-tk="comment">$1</span>');
  html = html.replace(/\b(import|from|export|const|let|var|function|async|await|new|return|if|else|true|false|null|undefined|void|type|interface|class|extends|implements|typeof|as)\b/g, '<span data-tk="keyword">$1</span>');
  html = html.replace(/\b([A-Z][a-zA-Z0-9]+)\b/g, '<span data-tk="type">$1</span>');
  html = html.replace(/\b(\d+)\b/g, '<span data-tk="value">$1</span>');

  return html;
}

type DemoSlug = 'chat' | 'structured' | 'tools' | 'relay' | 'session';

function Code({ lang, demo, children }: { lang: string; demo?: DemoSlug; children: string }) {
  const html = highlightCode(children, lang);
  const openDrawer = useContext(TryLiveContext);
  return (
    <div className="docs-code">
      {demo ? (
        <button
          type="button"
          className="docs-code-try"
          onClick={() => openDrawer?.(demo)}
        >
          <span>Try it live</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12h14M13 5l7 7-7 7"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : lang !== 'text' ? (
        <div className="docs-code-lang">{lang}</div>
      ) : null}
      <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
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
  --docs-bg: #fafaf9;
  --docs-bg-card: #ffffff;
  --docs-bg-elevated: #f5f5f4;
  --docs-border: #e7e5e4;
  --docs-text: #1c1917;
  --docs-text-secondary: #44403c;
  --docs-text-muted: #78716c;

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
  color: var(--teal-dark);
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

/* ── AI prompt CTA ── */

.docs-ai-cta {
  margin-top: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 22px;
  background: var(--docs-bg-card);
  border: 1px solid var(--docs-border);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.docs-ai-cta-text {
  min-width: 0;
}

.docs-ai-cta-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--docs-text);
  margin-bottom: 4px;
}

.docs-ai-cta-spark {
  color: var(--teal);
  font-size: 14px;
}

.docs-ai-cta-subtitle {
  font-size: 13.5px;
  color: var(--docs-text-muted);
  line-height: 1.5;
}

.docs-ai-cta-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--docs-text);
  color: var(--docs-bg-card);
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  font-family: inherit;
}

.docs-ai-cta-btn:hover {
  background: #000;
}

.docs-ai-cta-btn:active {
  transform: translateY(1px);
}

.docs-ai-cta-btn.copied {
  background: var(--teal);
  color: #fff;
}

@media (max-width: 640px) {
  .docs-ai-cta {
    flex-direction: column;
    align-items: stretch;
    gap: 14px;
  }
  .docs-ai-cta-btn {
    justify-content: center;
  }
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
  color: var(--teal-dark);
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

.docs-code-try {
  position: absolute;
  top: 8px;
  right: 10px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px 4px 11px;
  background: var(--teal);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.docs-code-try:hover {
  background: var(--teal-dark);
}

.docs-code-try:active {
  transform: translateY(1px);
}

.docs-code-try svg {
  transition: transform 0.15s;
}

.docs-code-try:hover svg {
  transform: translateX(2px);
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

/* ── Syntax highlighting ── */

[data-tk="keyword"] { color: #7c3aed; }
[data-tk="string"] { color: #16a34a; }
[data-tk="type"] { color: #0891b2; }
[data-tk="comment"] { color: #a8a29e; font-style: italic; }
[data-tk="value"] { color: #2563eb; }

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
  color: var(--teal-dark);
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

/* ── Drawer ── */

.docs-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 15, 15, 0.38);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
  z-index: 99;
}

.docs-drawer-backdrop.docs-drawer-backdrop-open {
  opacity: 1;
  pointer-events: auto;
}

.docs-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 100vw);
  background: #fff;
  border-left: 1px solid var(--docs-border);
  box-shadow: -12px 0 40px -20px rgba(0, 0, 0, 0.25);
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 100;
  display: flex;
  flex-direction: column;
  font-family: inherit;
}

.docs-drawer.docs-drawer-open {
  transform: translateX(0);
}

.docs-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--docs-border);
  flex-shrink: 0;
}

.docs-drawer-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--docs-text);
}

.docs-drawer-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d4d4d1;
  box-shadow: 0 0 0 3px rgba(120, 120, 120, 0.08);
}

.docs-drawer-dot[data-connected='true'] {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.18);
}

.docs-drawer-disconnect {
  margin-left: 10px;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--docs-border);
  border-radius: 5px;
  font: inherit;
  font-size: 11.5px;
  color: var(--docs-text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.docs-drawer-disconnect:hover {
  border-color: var(--docs-text-muted);
  color: var(--docs-text);
}

.docs-drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--docs-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.docs-drawer-close:hover {
  background: var(--docs-bg-elevated);
  color: var(--docs-text);
}

.docs-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px;
}

.docs-drawer-body .playground {
  border: none;
  margin: 0;
}

.docs-drawer-demo {
  min-height: auto !important;
  background: transparent !important;
  display: block !important;
  font-size: 14px;
}

/* Connect card inside drawer */

.docs-drawer-connect {
  max-width: 420px;
  margin: 8px auto;
  padding: 8px 4px;
}

.docs-drawer-connect h3 {
  font-size: 20px;
  font-weight: 700;
  margin: 0 0 10px;
  color: var(--docs-text);
}

.docs-drawer-connect p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--docs-text-secondary);
  margin: 0 0 18px;
}

.docs-drawer-connect-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 12px 18px;
  background: var(--teal);
  color: #fff;
  border: none;
  border-radius: 8px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.docs-drawer-connect-btn:hover:not(:disabled) {
  background: var(--teal-dark);
}

.docs-drawer-connect-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.docs-drawer-connect-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.docs-drawer-error {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin: 0 0 14px;
  padding: 10px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  font-size: 13px;
  line-height: 1.5;
}

.docs-drawer-error button {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}

.docs-drawer-features {
  list-style: none;
  padding: 0;
  margin: 16px 0 24px;
}

.docs-drawer-features li {
  position: relative;
  padding: 5px 0 5px 22px;
  font-size: 13.5px;
  color: var(--docs-text-secondary);
}

.docs-drawer-features li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--teal);
  font-weight: 700;
}

.docs-drawer-install {
  padding-top: 16px;
  border-top: 1px solid var(--docs-border);
  font-size: 13px;
  color: var(--docs-text-muted);
}

.docs-drawer-install-links {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.docs-drawer-install-links a {
  display: inline-block;
  padding: 5px 10px;
  background: var(--docs-bg-elevated);
  border-radius: 6px;
  color: var(--docs-text-secondary);
  font-size: 12.5px;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
}

.docs-drawer-install-links a:hover {
  background: var(--docs-border);
  color: var(--docs-text);
}
`;
