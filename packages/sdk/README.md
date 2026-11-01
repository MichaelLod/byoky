# @byoky/sdk

JavaScript SDK for [Byoky](https://byoky.com) -- connect to the user's Byoky wallet, proxy AI API calls through it, and manage sessions. Your users' API keys never leave their wallet, and no Byoky-hosted service sits in between.

## Install

```bash
npm install @byoky/sdk
```

## Quick Start

```typescript
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true, // built-in connect UI with install guidance
});

// Use any provider SDK -- keys never touch your app
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const msg = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Connection Modes

### Wallet in the browser

The SDK talks to the wallet via `window.postMessage`. The same protocol is served by:

- the Byoky browser extension (Chrome, Firefox),
- the Byoky Safari extension that ships with the iOS app,
- the built-in browser of the Byoky iOS and Android apps.

```typescript
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});
```

If no wallet is detected, `connect()` throws `WALLET_NOT_INSTALLED` (and opens the matching store page). With `modal: true` the SDK shows install guidance instead.

### Backend Relay

Your server makes LLM calls through the user's browser session. The WebSocket goes to your own server, and keys never leave the wallet, even server-side:

```typescript
// Server (Node.js)
import { ByokyServer } from '@byoky/sdk/server';

const server = new ByokyServer();
wss.on('connection', async (ws) => {
  const client = await server.handleConnection(ws);
  const fetch = client.createFetch('anthropic');
  // Make API calls -- proxied through the user's wallet
});
```

```typescript
// Browser
const relay = session.createRelay('wss://your-server.com/ws/relay');
```

## API

### `new Byoky(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | `number` | `60000` | Connection timeout in ms |
| `requestTimeout` | `number` | `600000` | How long a proxied request waits for the response headers, in ms; `0` waits forever. A non-streaming response sends its headers only once generation is done, so keep this above your longest generation. |

### `byoky.connect(request)`

Connect to the wallet. Returns a `ByokySession`.

```typescript
const session = await byoky.connect({
  providers: [
    { id: 'anthropic', required: true },
    { id: 'openai', required: false },
  ],
  modal: true, // or ModalOptions
});
```

| Option | Type | Description |
|--------|------|-------------|
| `providers` | `ProviderRequirement[]` | Providers to request access to |
| `modal` | `boolean \| ModalOptions` | Show built-in connect UI |

### `byoky.tryReconnect()`

Silently restore a previous session for this origin from the wallet. Returns `null` if no session exists.

```typescript
const session = await byoky.tryReconnect();
```

### `ByokySession`

| Property / Method | Description |
|-------------------|-------------|
| `sessionKey` | Unique session identifier |
| `providers` | Map of available providers with auth method |
| `createFetch(providerId)` | Create a proxied `fetch` function |
| `listModels(providerId)` | Discover models available to the user's credential (live, per provider) |
| `createRelay(wsUrl)` | Open a WebSocket relay to your backend |
| `disconnect()` | End the session |
| `isConnected()` | Check if session is still valid |
| `getUsage()` | Get token usage stats (input/output tokens) |
| `onDisconnect(cb)` | Subscribe to disconnection events |
| `onProvidersUpdated(cb)` | Subscribe to provider changes |

`session.providers` has an entry for every provider you requested; one the
wallet can't serve reads `{ available: false }`.

### Cancelling requests

The `fetch` from `createFetch` takes an `AbortSignal` like the real one:
aborting before the response headers rejects with the signal's reason (an
`AbortError` by default), aborting later errors the body, and either way the
wallet stops the upstream call. Without a signal, a request that gets no
response headers within `requestTimeout` rejects with a `PROXY_ERROR`.

If Byoky is updated while your page is open, calls fail at once with
`WALLET_RELOADED` (a proxied call answers status 503 with that code) and
`onDisconnect` fires. Ask the user to reload the page.

### Discover available models

Build a model picker that reflects what the user actually has access to —
including local models the user has installed in Ollama or LM Studio.

```typescript
const models = await session.listModels('anthropic');
// → [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 1_000_000, ... }]

const local = await session.listModels('ollama');
// → [{ id: 'llama3.2:3b', displayName: 'llama3.2:3b', ... }]
```

Returned shape: `{ id, providerId, displayName?, contextWindow?, capabilities?, raw }`.
Perplexity has no public model-list endpoint, so a hardcoded Sonar list is
returned. xAI does not document a `/v1/models` endpoint either — calling
`listModels('xai')` will throw `PROVIDER_UNAVAILABLE`.

When listing fails, the error says who refused: the wallet's own answers keep
their code (`PROVIDER_UNAVAILABLE` when the wallet has no credential for the
provider, `WALLET_LOCKED`, `QUOTA_EXCEEDED`, …), while a provider that
rejects the key gives `INVALID_KEY` and one that rate-limits `RATE_LIMITED`.

### `ByokyServer` (from `@byoky/sdk/server`)

Server-side relay handler.

```typescript
const server = new ByokyServer({ pingInterval: 30000, helloTimeout: 10000 });
const client = await server.handleConnection(ws);

client.sessionId;                    // Session identifier
client.providers;                    // Available providers
client.connected;                    // Connection status
client.createFetch('anthropic');     // Proxied fetch
client.close();                      // Close connection
client.onClose(() => { ... });       // Disconnect callback
```

| Option | Default | Description |
|--------|---------|-------------|
| `pingInterval` | `30000` | Keepalive ping interval in ms; `0` disables it |
| `helloTimeout` | `10000` | How long to wait for the browser's `relay:hello`, in ms |
| `requestTimeout` | `600000` | Fail a request when the browser sends nothing for it for this long, in ms; resets on every chunk; `0` disables it |

`client.createFetch` takes an `AbortSignal`, and aborting it (or cancelling
the response body) also stops the call in the browser and upstream. Request
bodies can be strings, bytes, `Blob`s, `FormData`, `URLSearchParams` or
streams, and the relay carries binary responses such as audio as bytes.

Every relay message is limited to 1 MB. A request whose body would exceed
that once serialized (binary bodies travel base64-encoded, about a third
larger) rejects with `PROXY_ERROR` before it is sent; responses of any size
are split into chunks.

### Connect Modal

The built-in modal connects to the wallet when one is present, and otherwise shows install guidance (store link for the current browser, a hint to use the Byoky app's built-in browser on phones). If the user dismisses it without a wallet, `connect()` rejects with `WALLET_NOT_INSTALLED`; a cancelled approval rejects with `Error('User cancelled')`.

```typescript
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: {
    theme: {
      accentColor: '#0ea5e9',
      backgroundColor: '#0d0d1a',
      textColor: '#e2e2ec',
      borderRadius: '16px',
    },
  },
});
```

## Utilities

```typescript
import { isExtensionInstalled, getStoreUrl } from '@byoky/sdk';

if (!isExtensionInstalled()) {
  console.log('Get Byoky:', getStoreUrl());
}
```

## Supported Providers

Anthropic, OpenAI, Google Gemini, Mistral, xAI, DeepSeek, Cohere, Groq, Perplexity, Together AI, Fireworks AI, OpenRouter, Azure OpenAI.

## License

[MIT](../../LICENSE)
