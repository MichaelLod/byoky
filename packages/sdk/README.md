# @byoky/sdk

JavaScript SDK for [Byoky](https://byoky.com) -- connect to the wallet extension, proxy AI API calls, and manage sessions. Your users' API keys never leave their device.

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
  modal: true, // built-in connect UI with QR code
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

### Browser Extension

The default path. The SDK communicates with the Byoky extension via `postMessage`:

```typescript
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});
```

### Mobile Wallet (Relay)

For users without the extension. Shows a QR code they scan with the Byoky mobile app:

```typescript
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  useRelay: true,
  modal: true, // shows QR code
});
```

### Backend Relay

Your server makes LLM calls through the user's browser. Keys never leave the extension, even server-side:

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
| `relayUrl` | `string` | `'wss://relay.byoky.com'` | WebSocket relay server URL |

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
| `useRelay` | `boolean` | Skip extension, go to relay pairing |
| `onPairingReady` | `(code: string) => void` | Custom pairing code handler |

### `byoky.tryReconnect()`

Silently restore a previous session. Returns `null` if no session exists.

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
| `createRelay(wsUrl)` | Open WebSocket relay for backend use |
| `disconnect()` | End the session |
| `isConnected()` | Check if session is still valid |
| `getUsage()` | Get token usage stats (input/output tokens) |
| `onDisconnect(cb)` | Subscribe to disconnection events |
| `onProvidersUpdated(cb)` | Subscribe to provider changes |

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

### Connect Modal

The built-in modal handles extension detection, relay fallback, and QR code display:

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
