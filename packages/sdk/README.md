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
  dangerouslyAllowBrowser: true, // safe with Byoky: apiKey is a session token, not a key
});

const msg = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

The Anthropic and OpenAI SDKs refuse to run in a browser unless you pass `dangerouslyAllowBrowser: true`, to keep real API keys out of page code. With Byoky the `apiKey` is a per-app session token and the real key stays in the wallet, so the flag is safe.

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
  try {
    const client = await server.handleConnection(ws);
    const fetch = client.createFetch('anthropic');
    // Make API calls -- proxied through the user's wallet
  } catch (err) {
    // A browser that never says hello, or a tab closed mid-request, rejects.
    // Catch it: an unhandled rejection here ends the Node process.
    console.error('[relay]', err);
  }
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
| `providers` | `ProviderRequirement[]` | Providers to request access to. `required: true` is a hint the wallet shows in the approval prompt; the connection succeeds without that provider, so check `session.providers[id]?.available` |
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
| `providers` | Map of providers: `available` (the wallet can serve it, directly or by routing) and `authMethod` |
| `createFetch(providerId)` | Create a proxied `fetch` function for the provider's inference and model-list endpoints (Files, Batches, Assistants and admin APIs get 403 `ENDPOINT_NOT_ALLOWED`) |
| `listModels(providerId)` | Discover models available to the user's credential (live, per provider) |
| `createRelay(wsUrl)` | Open a WebSocket relay to your backend |
| `disconnect()` | End the session and close its relays. Its fetches then reject with `NO_SESSION`; call `connect()` for a new one |
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
wallet stops the upstream call. An abort also ends the wait while an expired
session is renewed (the wallet asking the user to unlock or approve).
Cancelling the response body (`res.body.cancel()`, `reader.cancel()`, or
leaving a `for await` loop over it early) stops the upstream call as well.
With or without a signal, a request that gets no response headers within
`requestTimeout` is stopped the same way and rejects with a `PROXY_ERROR`.

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
returned.

When listing fails, the error says who refused: the wallet's own answers keep
their code (`PROVIDER_UNAVAILABLE` when the wallet has no credential for the
provider, `WALLET_LOCKED`, `QUOTA_EXCEEDED`, …), while a provider that
rejects the key gives `INVALID_KEY` and one that rate-limits `RATE_LIMITED`.

### `ByokyServer` (from `@byoky/sdk/server`)

Server-side relay handler.

| Option | Default | Description |
|--------|---------|-------------|
| `pingInterval` | `30000` | Keepalive ping interval in ms; `0` disables it |
| `helloTimeout` | `10000` | How long to wait for the browser's `relay:hello`, in ms |
| `requestTimeout` | `600000` | Fail a request when the browser sends nothing for it for this long, in ms; resets on every chunk; `0` disables it |

`client.createFetch` takes an `AbortSignal`, and aborting it (or cancelling
the response body) also stops the call in the browser and upstream. Request
bodies can be strings, bytes, `Blob`s, `FormData`, `URLSearchParams` or
streams, and the relay carries binary responses such as audio as bytes.

```typescript
const server = new ByokyServer({ pingInterval: 30000, helloTimeout: 10000 });
const client = await server.handleConnection(ws); // rejects, see below

client.sessionId;                    // Session identifier
client.providers;                    // Available providers
client.connected;                    // Connection status
client.createFetch('anthropic');     // Proxied fetch
client.close();                      // Close connection
client.onClose(() => { ... });       // Disconnect callback
```

`handleConnection()` rejects with `RELAY_CONNECTION_FAILED` when the browser
closes the socket or stays silent instead of sending its `relay:hello` (after
at most `helloTimeout`). `client.createFetch` requests, and their response
bodies, reject with `RELAY_DISCONNECTED` when the browser goes away
mid-request (a closed tab, a dropped network), and with the wallet's error when
the wallet refuses the request. Catch these inside an async `'connection'`
listener: Node ends the process on an unhandled rejection.

A request sent over the relay may be at most 1 MB once serialized (URL, headers and body); a larger one throws `ByokyError` `PROXY_ERROR` ("Request too large for the relay") before it is sent. Inline images count at their base64 size. Responses aren't capped.

### Connect Modal

The built-in modal connects to the wallet when one is present, and otherwise shows install guidance (store link for the current browser, a hint to use the Byoky app's built-in browser on phones). If the user dismisses it without a wallet, `connect()` rejects with `WALLET_NOT_INSTALLED`; a cancelled approval rejects with `Error('User cancelled')`.

By default it uses Byoky's dark violet look with square corners. A `theme` overrides the accent, background, text colour and corner radius; raised surfaces, borders and secondary text follow your background and text colours, so set both together.

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

## Errors

`connect()` and `listModels()` throw a `ByokyError` with a `code`. On `createFetch` requests, the wallet's own errors arrive as an HTTP status with `{ error: { code, message } }` in the JSON body, while a provider's own errors (401, 429, ...) arrive exactly as the provider sent them, with no Byoky code: check `res.status`.

| Code | Meaning |
|------|---------|
| `RATE_LIMITED` | Byoky's connect throttle: more than 10 new sessions per origin in 60 s (`err.details.retryAfter` in seconds), or a 429 from `listModels()`. Never a provider 429 on a proxied request. |
| `USER_REJECTED` | The user denied the request in the wallet, or it timed out. With `modal: true`, closing the modal rejects with `WALLET_NOT_INSTALLED` (no wallet found) or a plain `Error('User cancelled')`. |
| `QUOTA_EXCEEDED` | HTTP 429: the spending cap the user set for your app ran out. |
| `ENDPOINT_NOT_ALLOWED` | HTTP 403: the endpoint isn't an inference or model-list endpoint (Files, Batches, Assistants, admin APIs). |
| `SESSION_EXPIRED` | HTTP 401: the session was revoked, the wallet locked, or it expired. A `createFetch` request first renews the session and retries (the wallet asks the user to unlock or approve, or approves a trusted site silently), for a session from `tryReconnect()` too; you get the 401 only when that fails, and `onDisconnect` fires. Connect again. |

The full list is at [byoky.com/docs#errors](https://byoky.com/docs#errors).

## Utilities

```typescript
import { isExtensionInstalled, getStoreUrl } from '@byoky/sdk';

if (!isExtensionInstalled()) {
  console.log('Get Byoky:', getStoreUrl());
}
```

## Supported Providers

Anthropic, OpenAI, Google Gemini, Mistral, xAI, DeepSeek, Cohere, Groq, Perplexity, Together AI, Fireworks AI, OpenRouter, Azure OpenAI, plus local models through Ollama and LM Studio.

## License

[MIT](../../LICENSE)
