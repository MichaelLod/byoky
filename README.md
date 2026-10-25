<p align="center">
  <br />
  <strong>The MetaMask for API keys.</strong>
  <br />
  Keep every AI API key in one wallet. Apps connect to the wallet. Your keys never leave Byoky.
  <br />
  <br />
  <a href="https://byoky.com">Website</a> · <a href="https://byoky.com/docs">Docs</a> · <a href="https://byoky.com/demo">Demo</a> · <a href="#quick-start">Quick Start</a> · <a href="https://discord.gg/gRs8S9fxcT">Discord</a> · <a href="https://github.com/MichaelLod/byoky/issues">Issues</a>
  <br />
  <br />
  <a href="https://github.com/MichaelLod/byoky/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MichaelLod/byoky?style=flat&color=FF4F00" alt="License" /></a>
  <a href="https://github.com/MichaelLod/byoky/stargazers"><img src="https://img.shields.io/github/stars/MichaelLod/byoky?style=flat&color=FF4F00" alt="Stars" /></a>
  <a href="https://github.com/MichaelLod/byoky/issues"><img src="https://img.shields.io/github/issues/MichaelLod/byoky?style=flat&color=FF4F00" alt="Issues" /></a>
  <a href="https://github.com/MichaelLod/byoky/pulls"><img src="https://img.shields.io/badge/PRs-welcome-FF4F00?style=flat" alt="PRs Welcome" /></a>
  <a href="https://www.npmjs.com/package/@byoky/sdk"><img src="https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=FF4F00&label=npm" alt="npm" /></a>
  <a href="https://discord.gg/gRs8S9fxcT"><img src="https://img.shields.io/discord/1485230270192943184?style=flat&color=5865F2&label=discord" alt="Discord" /></a>
</p>

---

## What is Byoky?

**Byoky** (Bring Your Own Key) is a wallet for your AI credentials: a browser extension plus iOS and Android apps. You add your API keys and setup tokens once, and they're encrypted on your device. Apps connect to the wallet the way dapps connect to MetaMask. They ask for access, you approve, and the wallet makes their LLM calls for them. The app never sees the key.

- **One wallet, every provider.** Anthropic, OpenAI, Gemini, Mistral and nine more, plus custom endpoints. Add a key once and use it in every Byoky-enabled app.
- **Apps connect instead of copying keys.** No more pasting `sk-...` into a settings page. Approve an app, see every request it makes, set spending caps, revoke it with one click.
- **No servers.** No accounts, no cloud sync, no relay. Byoky doesn't run anything that sits between you and your provider. The wallet talks only to the AI providers you add.
- **Groups.** Bucket connected apps by purpose ("Personal", "Work"), pin each group to a credential, then drag apps between groups to switch which key they use. Live sessions reroute without code changes.
- **Cross-provider routing.** Drag an app from a Claude group into a GPT group and the wallet translates on the fly: Anthropic ↔ OpenAI ↔ Gemini ↔ Cohere request bodies, response bodies and SSE streams.
- **Fully open source.** Every component, including the mobile apps, is in this repo under MIT.

### How it works

```
1. Install the Byoky wallet → set a master password
2. Add your API keys or a Claude setup token → encrypted on this device
3. Open any Byoky-enabled app → approve access → the wallet proxies its calls
```

## Install

| Platform | Version | Link |
|----------|---------|------|
| Chrome | ![Chrome version](https://img.shields.io/chrome-web-store/v/igjohldpldlahcjmefdhlnbcpldlgmon?style=flat&color=FF4F00&label=) | [Chrome Web Store](https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon) |
| Firefox | ![Firefox version](https://img.shields.io/amo/v/byoky?style=flat&color=FF4F00&label=) | [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/) |
| iOS | — | [App Store](https://apps.apple.com/app/byoky/id6760779919) (wallet + Safari extension) |
| Android | — | [Google Play](https://play.google.com/store/apps/details?id=com.byoky.app) (wallet + in-wallet browser) |
| Safari (macOS) | Coming soon | — |
| npm | ![npm version](https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=FF4F00&label=) | [`@byoky/sdk`](https://www.npmjs.com/package/@byoky/sdk) · [`@byoky/core`](https://www.npmjs.com/package/@byoky/core) · [`@byoky/bridge`](https://www.npmjs.com/package/@byoky/bridge) |

## Where apps can connect

Each wallet serves the apps on its own device:

| App runs in… | Connects through | Keys live in |
|---|---|---|
| Desktop browser (Chrome, Firefox) | Byoky browser extension | the extension |
| Safari on iPhone / iPad | Byoky Safari extension (ships inside the iOS app) | the Safari extension |
| Byoky's in-wallet browser (iOS, Android) | injected wallet bridge (open any https app by URL) | the mobile app |
| CLI tools and desktop apps | `@byoky/bridge` (localhost) → native messaging | the extension |
| Your backend | `@byoky/sdk/server` over your own WebSocket → user's browser | the extension |

## Quick Start

### For Developers

**Scaffold a new app:**

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

> **Two lines changed.** Full API compatibility: streaming, file uploads and vision all work. `session.sessionKey` is a per-app session token, not the user's key. Sessions auto-reconnect if the extension restarts.

### Backend Relay

Need LLM calls from your server? The user's browser relays them through the wallet over a WebSocket **you** host. Your backend never sees the API key, and no Byoky server is involved.

```
Your backend ←WebSocket (your server)→ User's browser ←→ Byoky extension → LLM API
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

### CLI / Local Apps (Bridge)

CLI tools and desktop apps route API calls through the bridge, a localhost HTTP proxy that hands requests to the extension over native messaging. Keys never leave the extension.

```
CLI app → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

```bash
npm install -g @byoky/bridge
byoky-bridge install   # register native messaging host
byoky-bridge connect   # approve a session, start the proxy on 127.0.0.1:19280

# Clients send the bridge token as their API key:
export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
export ANTHROPIC_API_KEY=$(byoky-bridge token)
```

### OpenClaw Integration

Use your Byoky wallet as the key provider for [OpenClaw](https://openclaw.dev). The plugin connects through the bridge, so your keys stay in the extension even when the agent runs in your terminal. See the [OpenClaw plugin](packages/openclaw-plugin) for setup.

```
OpenClaw → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

**Setup tokens work too.** OpenClaw (and other third-party agent frameworks) can use a Claude.ai setup token as the Anthropic credential, not just an `sk-ant-api03-...` API key. The bridge rewrites tool names and moves the framework's system prompt out of the system field on the way out, then reverses the tool names on the streaming response. Anthropic's first-party detection accepts the request and the agent behaves as before.

## Security

| | |
|---|---|
| **AES-256-GCM** | Keys encrypted with a PBKDF2-derived key (600K iterations) via the Web Crypto API (Keychain / Keystore-backed on mobile) |
| **Zero exposure** | API keys never leave the wallet. Apps get per-session tokens |
| **No servers** | No accounts, no cloud sync, no relay, no telemetry. Requests go straight from your wallet to the provider |
| **Password strength** | 12-character minimum with a real-time strength meter (entropy, patterns, common passwords) |
| **Encrypted backup** | Export/import `.byoky` files protected by a separate export password, in every wallet. This is how you move keys between devices; no cloud involved |
| **Audit log** | Every request logged locally: app origin, provider, status, timestamp |
| **Spending caps** | Token allowances per app (total and per-provider), enforced at the proxy |

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
| OpenRouter | ✓ | — | Available |
| Azure OpenAI | ✓ | — | Available |
| *Custom* | ✓ | — | Extensible |

> **Setup Token**: Use your Claude Pro/Max subscription via `claude setup-token`. API keys use pay-per-use billing from the provider console.

## Architecture

Byoky uses a **proxy model**: keys never leave the wallet, and every integration path ends at a wallet on the user's own device.

```
Browser apps   → SDK (createFetch) → Content Script → Extension → LLM API
Safari (iOS)   → SDK (createFetch) → Content Script → Safari Extension → LLM API
In-wallet apps → SDK (createFetch) → Native bridge → iOS / Android app → LLM API
Backend apps   → SDK/server (your WebSocket) → User's browser → Extension → LLM API
CLI/desktop    → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

The SDK provides `createFetch()`, a drop-in `fetch` replacement that routes through the wallet. It works with **any provider's native SDK**.

## Project Structure

```
byoky/
├── packages/
│   ├── core/             # Shared types, crypto, protocol, provider registry, translation
│   ├── sdk/              # @byoky/sdk (+ @byoky/sdk/server for backend relay)
│   ├── extension/        # Browser extension (Chrome, Firefox, Safari) — WXT
│   ├── bridge/           # @byoky/bridge — localhost proxy + native messaging for CLI/desktop apps
│   ├── ios/              # iOS app (wallet + Safari extension + in-wallet browser)
│   ├── android/          # Android app (wallet + in-wallet browser)
│   ├── openclaw-plugin/  # OpenClaw provider plugin (via the bridge)
│   ├── create-byoky-app/ # CLI scaffolder — npx create-byoky-app
│   └── web/              # byoky.com — landing page, docs, demo, chat
├── e2e/                  # Playwright tests against the real extension
└── marketing/            # Screenshot + composite + video pipeline (gitignored outputs)
```

## Development

```bash
pnpm install              # Install dependencies
pnpm dev                  # Start extension in dev mode (Chrome)
pnpm build                # Build all packages
pnpm typecheck            # Type check everything
pnpm test                 # Unit tests
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

**Mobile:** open `packages/ios/Byoky.xcodeproj` in Xcode, or `packages/android` in Android Studio. Both embed the core translation bundle. Run `./scripts/sync-mobile-bundle.sh` after changing `packages/core/src/translate/`.

## Marketing pipeline

`marketing/` holds a self-contained pipeline that generates store screenshots, composites and narrated walkthrough videos. It reuses the e2e Playwright fixtures and the iOS/Android simulators.

```bash
pnpm marketing:install                  # one-time: Sharp, Playwright, Chromium
pnpm marketing:desktop                  # Chrome + web + composites + narration + video
pnpm marketing:capture:ios              # requires booted iOS simulator
pnpm marketing:capture:android          # requires adb-visible emulator
pnpm marketing:all                      # end-to-end
```

## Tech Stack

| | |
|---|---|
| **Extension** | [WXT](https://wxt.dev) · React · Zustand · Web Crypto API |
| **Mobile** | SwiftUI · Kotlin / Jetpack Compose · shared JS translation bundle |
| **SDK** | TypeScript · built-in connect modal · zero dependencies (except @byoky/core) |
| **Monorepo** | pnpm workspaces · TypeScript strict mode |

## Built with Byoky

| Project | Description |
|---------|-------------|
| [LamboChart](https://lambochart.com) | AI-powered analytics for vibe coders — users bring their own LLM keys via Byoky |

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

[MIT](LICENSE). Everything that makes up Byoky, from the wallets and SDK to the bridge and the website, lives in this repository. There are no closed components and no hosted services.
