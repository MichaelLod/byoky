<p align="center">
  <br />
  <a href="https://byoky.com">
    <img src="https://github.com/MichaelLod/byoky/raw/main/.github/icon.svg?v=2" alt="Muninn" width="80" />
  </a>
  <br />
  <a href="https://byoky.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg?v=2">
      <img alt="Byoky" src="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg?v=2" width="480">
    </picture>
  </a>
  <br />
  <strong>MetaMask for AI</strong>
  <br />
  A secure browser wallet for your LLM API keys and auth tokens.
  <br />
  Your keys never leave the extension.
  <br />
  <br />
  <a href="https://byoky.com">Website</a> · <a href="#quick-start">Quick Start</a> · <a href="#for-developers">SDK Docs</a> · <a href="https://github.com/MichaelLod/byoky/issues">Issues</a>
  <br />
  <br />
  <a href="https://github.com/MichaelLod/byoky/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MichaelLod/byoky?style=flat&color=0ea5e9" alt="License" /></a>
  <a href="https://github.com/MichaelLod/byoky/stargazers"><img src="https://img.shields.io/github/stars/MichaelLod/byoky?style=flat&color=0ea5e9" alt="Stars" /></a>
  <a href="https://github.com/MichaelLod/byoky/issues"><img src="https://img.shields.io/github/issues/MichaelLod/byoky?style=flat&color=0ea5e9" alt="Issues" /></a>
  <a href="https://github.com/MichaelLod/byoky/pulls"><img src="https://img.shields.io/badge/PRs-welcome-0ea5e9?style=flat" alt="PRs Welcome" /></a>
  <a href="https://www.npmjs.com/package/@byoky/sdk"><img src="https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=0ea5e9&label=npm" alt="npm" /></a>
</p>

---

## What is Byoky?

**Byoky** (Bring Your Own Key) is an open-source browser extension that stores your AI API keys and OAuth tokens in an encrypted vault. Developers integrate via `@byoky/sdk` — their apps can use your credentials without ever seeing them.

- **For users** — One wallet for all your AI credentials. Add keys, approve apps, revoke access. Full visibility into every request.
- **For developers** — Two lines of code. Use your favorite provider SDK. Keys never touch your app.

<p align="center">
  <img src="https://github.com/MichaelLod/byoky/raw/main/.github/screenshots/screenshot-1.png" alt="Byoky Wallet" width="400" />&nbsp;&nbsp;<img src="https://github.com/MichaelLod/byoky/raw/main/.github/screenshots/screenshot-2.png" alt="Byoky Unlock" width="400" />
</p>

### How it works

```
1. Install the Byoky wallet → set a master password
2. Add your API keys or sign in via OAuth → encrypted locally
3. Visit any Byoky-enabled app → approve access → keys stay in the vault
```

## Quick Start

### For Users

```bash
# Coming soon to browser extension stores
# For now, build from source:
git clone https://github.com/MichaelLod/byoky.git
cd byoky && pnpm install && pnpm dev
# Load unpacked extension from packages/extension/.output/chrome-mv3
```

### For Developers

```bash
npm install @byoky/sdk
```

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});

// Use the native Anthropic SDK — just swap in Byoky's fetch
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

// Everything works exactly like normal, including streaming
const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

> **Two lines changed.** Full API compatibility. Streaming works. Keys never exposed.

### Backend Relay

Need LLM calls from your server? The user's browser relays requests through the extension — your backend never sees the API key.

```
Backend ←WebSocket→ User's Frontend ←Extension→ LLM API
```

```typescript
// Frontend — open a relay so the backend can make LLM calls
const session = await new Byoky().connect({ providers: [{ id: 'anthropic' }] });
const relay = session.createRelay('wss://your-app.com/ws/relay');
```

```typescript
// Backend (Node.js)
import { ByokyServer } from '@byoky/sdk/server';

const byoky = new ByokyServer();
wss.on('connection', async (ws) => {
  const client = await byoky.handleConnection(ws);
  const fetch = client.createFetch('anthropic');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello!' }],
    }),
  });
});
```

## Security

| | |
|---|---|
| **AES-256-GCM** | Keys encrypted with PBKDF2-derived key (600K iterations) via Web Crypto API |
| **Zero exposure** | API keys never leave the extension. Apps get temporary session tokens |
| **Password strength** | 12-char minimum with real-time strength meter (entropy, patterns, common passwords) |
| **Vault backup** | Encrypted export/import (`.byoky` files) with separate export password |
| **Audit log** | Every request logged — app origin, provider, status, timestamp |
| **Spending caps** | Token allowances per app — total and per-provider limits, enforced at the proxy |
| **Local only** | No cloud. No telemetry. No tracking. Your device, your keys |

## Supported Providers

| Provider | API Key | Setup Token | Status |
|----------|:-------:|:-----------:|--------|
| Anthropic | ✓ | ✓ | Available |
| OpenAI | ✓ | — | Available |
| Google Gemini | ✓ | — | Available |
| Mistral | ✓ | — | Available |
| Cohere | ✓ | — | Available |
| xAI (Grok) | ✓ | — | Available |
| DeepSeek | ✓ | — | Available |
| Perplexity | ✓ | — | Available |
| Groq | ✓ | — | Available |
| Together AI | ✓ | — | Available |
| Fireworks AI | ✓ | — | Available |
| Replicate | ✓ | — | Available |
| OpenRouter | ✓ | — | Available |
| Hugging Face | ✓ | — | Available |
| Azure OpenAI | ✓ | — | Available |
| *Custom* | ✓ | — | Extensible |

> **Setup Token**: Use your Claude Pro/Max subscription via `claude setup-token`. API keys use pay-per-use billing from the provider console.

## Architecture

Byoky uses a **proxy model** (like MetaMask's transaction signing). Keys never leave the extension:

```
App → SDK (createFetch) → CustomEvent → Content Script
  → chrome.runtime.Port → Background Script → fetch(real API + real key)
  → streams response back through the same chain
```

The SDK provides `createFetch()` — a drop-in `fetch` replacement that routes through the extension. Works with **any provider's native SDK**.

For server-side apps, `createRelay()` opens a WebSocket channel so the backend can make LLM calls through the user's browser. The backend gets a `fetch`-like API via `@byoky/sdk/server`.

## Project Structure

```
byoky/
├── packages/
│   ├── core/          # Shared types, crypto, protocol, provider registry
│   ├── sdk/           # @byoky/sdk (+ @byoky/sdk/server for backend relay)
│   ├── extension/     # Browser extension (Chrome, Firefox, Safari) — WXT
│   ├── bridge/        # @byoky/bridge — native messaging for setup tokens
│   ├── demo/          # Demo app — demo.byoky.com
│   └── web/           # Landing page — byoky.com
```

## Development

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start extension in dev mode (Chrome)
pnpm build                # Build all packages
pnpm typecheck            # Type check everything
```

**Browser-specific builds:**

```bash
pnpm --filter @byoky/extension dev:firefox
pnpm --filter @byoky/extension build:all     # Chrome + Firefox + Safari
```

**Load in Chrome:**
1. `pnpm dev`
2. Navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `packages/extension/.output/chrome-mv3`

## Tech Stack

| | |
|---|---|
| **Extension** | [WXT](https://wxt.dev) · React · Zustand · Web Crypto API |
| **SDK** | TypeScript · zero dependencies (except @byoky/core) |
| **Monorepo** | pnpm workspaces · TypeScript strict mode |
| **Browsers** | Chrome (MV3) · Firefox · Safari |

## Roadmap

- [x] Backend relay (`@byoky/sdk/server`)
- [x] Token allowances per app (total + per-provider limits)
- [x] Encrypted vault export/import (`.byoky` files)
- [ ] Browser extension store listings

## Star History

<a href="https://star-history.com/#MichaelLod/byoky&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MichaelLod/byoky&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MichaelLod/byoky&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MichaelLod/byoky&type=Date" />
 </picture>
</a>

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — free forever.
