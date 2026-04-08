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
  <strong>Bring Your Own Key</strong>
  <br />
  A secure browser wallet for your LLM API keys and setup tokens.
  <br />
  Your keys never leave your device.
  <br />
  <br />
  <a href="https://byoky.com">Website</a> · <a href="https://byoky.com/apps">MiniApps</a> · <a href="https://byoky.com/dev">Developer Hub</a> · <a href="https://demo.byoky.com">Demo</a> · <a href="#quick-start">Quick Start</a> · <a href="https://discord.gg/gRs8S9fxcT">Discord</a> · <a href="https://github.com/MichaelLod/byoky/issues">Issues</a>
  <br />
  <br />
  <a href="https://github.com/MichaelLod/byoky/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MichaelLod/byoky?style=flat&color=0ea5e9" alt="License" /></a>
  <a href="https://github.com/MichaelLod/byoky/stargazers"><img src="https://img.shields.io/github/stars/MichaelLod/byoky?style=flat&color=0ea5e9" alt="Stars" /></a>
  <a href="https://github.com/MichaelLod/byoky/issues"><img src="https://img.shields.io/github/issues/MichaelLod/byoky?style=flat&color=0ea5e9" alt="Issues" /></a>
  <a href="https://github.com/MichaelLod/byoky/pulls"><img src="https://img.shields.io/badge/PRs-welcome-0ea5e9?style=flat" alt="PRs Welcome" /></a>
  <a href="https://www.npmjs.com/package/@byoky/sdk"><img src="https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=0ea5e9&label=npm" alt="npm" /></a>
  <a href="https://discord.gg/gRs8S9fxcT"><img src="https://img.shields.io/discord/1485230270192943184?style=flat&color=5865F2&label=discord" alt="Discord" /></a>
</p>

---

## What is Byoky?

**Byoky** (Bring Your Own Key) is an open-source browser extension that stores your AI API keys and setup tokens in an encrypted vault. Developers integrate via `@byoky/sdk` — their apps can use your credentials without ever seeing them.

- **For users** — One wallet for all your AI credentials. Add keys, approve apps, revoke access, export encrypted backups. Full visibility into every request.
- **For developers** — Two lines of code. Use your favorite provider SDK. Keys never touch your app.
- **Groups** — Bucket connected apps by purpose (e.g. "Personal", "Work"). Pin each group to a specific credential, then drag apps between groups to switch which key they use. Live sessions reroute automatically — no code changes in any app.
- **Token gifts** — Share token access with friends or teammates without sharing your API key. Set budgets and expiration. All requests relay through your wallet.

<p align="center">
  <img src="https://github.com/MichaelLod/byoky/raw/main/.github/screenshots/screenshot-1.png?v=2" alt="Byoky Wallet" width="400" height="1051" />&nbsp;&nbsp;<img src="https://github.com/MichaelLod/byoky/raw/main/.github/screenshots/screenshot-2.png?v=2" alt="Byoky Unlock" width="400" height="1051" />
</p>

### How it works

```
1. Install the Byoky wallet → set a master password
2. Add your API keys or a Claude setup token → encrypted locally
3. Visit any Byoky-enabled app → approve access → keys stay in the vault
```

## Install

| Platform | Status | Link |
|----------|--------|------|
| Chrome | Available | [Chrome Web Store](https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon) |
| Firefox | Available | [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/) |
| Safari (iOS) | Available | [App Store](https://apps.apple.com/app/byoky/id6760779919) |
| Safari (macOS) | Coming soon | — |
| Android | Coming soon | — |
| npm `@byoky/sdk` | Available | [npmjs.com](https://www.npmjs.com/package/@byoky/sdk) |
| npm `@byoky/core` | Available | [npmjs.com](https://www.npmjs.com/package/@byoky/core) |
| npm `@byoky/bridge` | Available | [npmjs.com](https://www.npmjs.com/package/@byoky/bridge) |
| npm `@byoky/relay` | Available | [npmjs.com](https://www.npmjs.com/package/@byoky/relay) |
| npm `@byoky/openclaw-plugin` | Available | [npmjs.com](https://www.npmjs.com/package/@byoky/openclaw-plugin) |
| npm `create-byoky-app` | Available | [npmjs.com](https://www.npmjs.com/package/create-byoky-app) |

## Quick Start

### For Users

**Chrome:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon)

**Firefox:** [Install from Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/)

**iOS (Safari):** [Install from App Store](https://apps.apple.com/app/byoky/id6760779919)

### For Developers

**Generate a full app from a description — powered by your own keys:**

> **[byoky.com/dev](https://byoky.com/dev)** — Connect your wallet, describe your app, and we generate it with AI. Push to GitHub in one click. Zero cost — your keys power everything.

**Or scaffold locally:**

```bash
npx create-byoky-app
```

**Or add to an existing project:**

```bash
npm install @byoky/sdk
```

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
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

> **Two lines changed.** Full API compatibility. Streaming, file uploads, and vision all work. Keys never exposed. Sessions auto-reconnect if the extension restarts.

### Mobile Wallet (No Extension Needed)

No browser extension? Users can connect with the Byoky iOS app instead. The SDK connects via relay — showing a pairing code that the user scans with their phone.

```
Web App ←WebSocket→ Relay Server ←WebSocket→ Phone Wallet → LLM API
```

With `modal: true`, the connect modal automatically detects whether the extension is installed. If not, it falls back to relay mode and shows a built-in QR code for mobile pairing — no custom UI needed.

```typescript
// Works with both extension and mobile — modal handles detection and QR code
const session = await byoky.connect({ modal: true });
```

> **Works on any browser, any device.** No extension install required. Keys stay on the phone.

### Backend Relay

Need LLM calls from your server? The user's browser relays requests through the extension — your backend never sees the API key.

```
Backend ←WebSocket→ User's Frontend ←Extension→ LLM API
```

```typescript
// Frontend — open a relay so the backend can make LLM calls
const session = await new Byoky().connect({ providers: [{ id: 'anthropic' }], modal: true });
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

### CLI / Local Apps (Bridge Proxy)

CLI tools and desktop apps can route API calls through the bridge — a local HTTP proxy that relays requests to the extension. Keys never leave the extension.

```
CLI App → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

```bash
npm install -g @byoky/bridge
byoky-bridge install   # register native messaging host
```

### Token Gifts (Relay)

Share token access without sharing your API key. The sender's extension proxies all requests — the key never leaves the wallet.

```
Sender's Extension ←WebSocket→ Relay Server ←WebSocket→ Recipient's Extension
```

**Create a gift:**
1. Open the wallet → select a credential → click "Gift"
2. Set a token budget and expiry
3. Share the generated gift link

**Redeem a gift:**
1. Open the wallet → click "Redeem Gift"
2. Paste the gift link → accept

**Self-host the relay:**
```bash
npm install -g @byoky/relay
byoky-relay  # default port 8787
```

> **Privacy guarantee:** The recipient never receives your API key. Every request is relayed through the sender's running extension, which enforces the token budget and can revoke access at any time.

### OpenClaw Integration

Use your Byoky wallet as the key provider for [OpenClaw](https://openclaw.dev). The plugin connects through the bridge — your keys never leave the extension, even from the CLI.

```
OpenClaw → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

All 15 providers are available through the plugin. Install the bridge, connect your wallet, and OpenClaw uses your Byoky credentials transparently. See the [OpenClaw plugin](packages/openclaw-plugin) for setup instructions.

**Setup tokens too.** Since v0.4.19, OpenClaw (and any other third-party agent framework) can use a Claude.ai setup token as the byoky-anthropic credential — not just a `sk-ant-api03-...` API key. The bridge transparently rewrites tool names and relocates the framework's system prompt out of the system field on the way out, then reverses tool names on the streaming response, so Anthropic's first-party detection accepts the request without breaking the agent's behavior.

#### Remote OpenClaw (Cloud Deployment)

Run OpenClaw on a remote server (Railway, Fly.io, etc.) and keep your API keys on your device. The relay bridges the gap — your cloud instance never sees your credentials.

```
OpenClaw (Railway) ←WebSocket→ Relay Server ←WebSocket→ Your Wallet → LLM API
```

No environment variables. No secrets management. No leaked `.env` files. Your keys stay in the wallet, and OpenClaw runs wherever you need it.

## Security

| | |
|---|---|
| **AES-256-GCM** | Keys encrypted with PBKDF2-derived key (600K iterations) via Web Crypto API |
| **Zero exposure** | API keys never leave the extension. Apps get temporary session tokens |
| **Password strength** | 12-char minimum with real-time strength meter (entropy, patterns, common passwords) |
| **Vault backup** | Encrypted export/import (`.byoky` files) with separate export password |
| **Audit log** | Every request logged — app origin, provider, status, timestamp |
| **Spending caps** | Token allowances per app — total and per-provider limits, enforced at the proxy |
| **Token gifts** | Share access without sharing keys — relay-backed with budget enforcement, sender-side proxy |
| **Local only** | No cloud. No telemetry. No tracking. Your device, your keys |

## Supported Providers

| Provider | API Key | OAuth | Status |
|----------|:-------:|:-----:|--------|
| Anthropic | ✓ | Setup Token | Available |
| OpenAI | ✓ | — | Available |
| Google Gemini | ✓ | Google OAuth | Available |
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
| Hugging Face | ✓ | HF OAuth | Available |
| Azure OpenAI | ✓ | — | Available |
| *Custom* | ✓ | — | Extensible |

> **OAuth**: Sign in with your Google or Hugging Face account — no API key needed. **Setup Token**: Use your Claude Pro/Max subscription via `claude setup-token`. API keys use pay-per-use billing from the provider console.

## Architecture

Byoky uses a **proxy model**. Keys never leave the extension. Three integration paths, same guarantee:

```
Browser apps  → SDK (createFetch) → Content Script → Extension → LLM API
Mobile wallet → SDK (createFetch) → WebSocket → Relay → Phone App → LLM API
Backend apps  → SDK/server (WebSocket) → User's Browser → Extension → LLM API
CLI/desktop   → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
Remote apps   → WebSocket → Relay Server → WebSocket → Your Wallet → LLM API
Token gifts   → WebSocket → Relay Server → WebSocket → Sender's Extension → LLM API
```

The SDK provides `createFetch()` — a drop-in `fetch` replacement that routes through the extension. Works with **any provider's native SDK**.

## Project Structure

```
byoky/
├── packages/
│   ├── core/          # Shared types, crypto, protocol, provider registry
│   ├── sdk/           # @byoky/sdk (+ @byoky/sdk/server for backend relay)
│   ├── extension/     # Browser extension (Chrome, Firefox, Safari) — WXT
│   ├── bridge/        # @byoky/bridge — HTTP proxy + native messaging for CLI/desktop apps
│   ├── relay/         # @byoky/relay — WebSocket relay server
│   ├── ios/           # iOS app (wallet + Safari extension)
│   ├── openclaw-plugin/ # OpenClaw provider plugin
│   ├── create-byoky-app/ # CLI scaffolder — npx create-byoky-app
│   ├── vault/         # Encrypted cloud vault backup server
│   └── web/           # Landing page (byoky.com) + MiniApps marketplace + Developer Hub
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
| **SDK** | TypeScript · built-in connect modal with QR code for mobile pairing · zero dependencies (except @byoky/core) |
| **Monorepo** | pnpm workspaces · TypeScript strict mode |
| **Browsers** | Chrome (MV3) · Firefox · Safari |

## Roadmap

- [x] Backend relay (`@byoky/sdk/server`)
- [x] Token allowances per app (total + per-provider limits)
- [x] Encrypted vault export/import (`.byoky` files)
- [x] Browser extension store listings (Chrome, Firefox)
- [x] OpenClaw provider plugin (bridge proxy — keys stay in extension)
- [x] Token gifts (relay-backed, zero key exposure)
- [x] Mobile wallet relay connect (no extension needed, pair via QR code)
- [x] iOS app (wallet + Safari extension + relay pairing)
- [x] Developer Hub + create-byoky-app CLI scaffolder
- [x] MiniApps marketplace (byoky.com/apps)
- [x] Alias groups — drag apps between groups to swap which credential they use
- [x] Setup token compatibility for third-party agents (OpenClaw etc.) — transparent tool name + system prompt rewriting
- [ ] Cross-provider translation — drag an app from a Claude group to a GPT group and have requests transparently rewrite (request body, response body, SSE streams)
- [ ] Remote OpenClaw via relay (cloud deployment, zero key exposure)
- [ ] Password change (re-encrypt vault with new master password)

## MiniApps

**[byoky.com/apps](https://byoky.com/apps)** — A marketplace of single-HTML AI tools that run on your own API keys. Connect your wallet, pick an app, and it works instantly. No accounts, no costs.

**Included apps:** AI Chat, Code Explainer, Email Writer, Translator, Study Cards, Roast My Code.

**Build your own:** The [App Generator](https://byoky.com/dev) creates miniapp HTML alongside full projects. Publish to GitHub Gist and submit to the registry.

**How miniapps work:**
- Each miniapp is a self-contained HTML file (inline CSS + JS)
- Runs in a sandboxed iframe on byoky.com
- API calls are proxied through the parent page via postMessage → the Byoky extension handles key injection
- Supports streaming responses (SSE) for real-time output

## Built with Byoky

| Project | Description |
|---------|-------------|
| [LamboChart](https://lambochart.com) | AI-powered analytics for vibe coders — users bring their own LLM keys via Byoky |

[Add your project →](https://byoky.com/built-with)

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
