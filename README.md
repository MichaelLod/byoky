<p align="center">
  <br />
  <a href="https://byoky.com">
    <img src="https://github.com/MichaelLod/byoky/raw/main/.github/icon.svg?v=3" alt="Byoky" width="96" />
  </a>
  <br />
  <a href="https://byoky.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg?v=3">
      <img alt="Byoky" src="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg?v=3" width="480">
    </picture>
  </a>
  <br />
  <strong>Your AI budget is going to waste.</strong>
  <br />
  Byoky lets you share your token budget with friends, your team, or anyone building cool stuff — without exposing your keys.
  <br />
  <br />
  <a href="https://byoky.com">Website</a> · <a href="https://byoky.com/docs">Docs</a> · <a href="https://byoky.com/apps">Apps</a> · <a href="https://byoky.com/token-pool">Token Pool</a> · <a href="https://byoky.com/demo">Demo</a> · <a href="#quick-start">Quick Start</a> · <a href="https://discord.gg/gRs8S9fxcT">Discord</a> · <a href="https://github.com/MichaelLod/byoky/issues">Issues</a>
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

**Byoky** (Bring Your Own Key) is an open-source browser extension that stores your AI API keys and setup tokens in an encrypted vault. Developers integrate via `@byoky/sdk` — their apps can use your credentials without ever seeing them.

- **For users** — One wallet for all your AI credentials. Add keys, approve apps, revoke access, export encrypted backups. Full visibility into every request.
- **For developers** — Two lines of code. Use your favorite provider SDK. Keys never touch your app.
- **Groups** — Bucket connected apps by purpose (e.g. "Personal", "Work"). Pin each group to a specific credential, then drag apps between groups to switch which key they use. Live sessions reroute automatically — no code changes in any app.
- **Cross-provider routing** — Drag an app from a Claude group into a GPT group and the wallet transparently translates the request. Anthropic ↔ OpenAI ↔ Gemini ↔ Cohere — request body, response body, and SSE streams are rewritten on the fly. Apps keep calling their preferred SDK; the wallet picks the upstream.
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

| Platform | Version | Link |
|----------|---------|------|
| Chrome | ![Chrome version](https://img.shields.io/chrome-web-store/v/igjohldpldlahcjmefdhlnbcpldlgmon?style=flat&color=FF4F00&label=) | [Chrome Web Store](https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon) · [Install from source](INSTALL.md#chrome-install-from-source) — **required for v0.7.0 until review clears** |
| Firefox | ![Firefox version](https://img.shields.io/amo/v/byoky?style=flat&color=FF4F00&label=) | [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/) — **v0.7.0 live** |
| iOS | ![npm version](https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=FF4F00&label=) | [App Store](https://apps.apple.com/app/byoky/id6760779919) — v1.0.16 in Apple review, v1.0.12 live |
| Android | ![npm version](https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=FF4F00&label=) | [Google Play](https://play.google.com/store/apps/details?id=com.byoky.app) — **v1.0.16 live** |
| Safari (macOS) | Coming soon | — |
| npm | ![npm version](https://img.shields.io/npm/v/@byoky/sdk?style=flat&color=FF4F00&label=) | [`@byoky/sdk`](https://www.npmjs.com/package/@byoky/sdk) · [`@byoky/core`](https://www.npmjs.com/package/@byoky/core) · [`@byoky/bridge`](https://www.npmjs.com/package/@byoky/bridge) · [`@byoky/relay`](https://www.npmjs.com/package/@byoky/relay) |

> **v0.7.0 rollout status:** Firefox and Android are live. Chrome is still in Google's review queue — in the meantime, [build from source and load unpacked](INSTALL.md#chrome-install-from-source) to get the new features today. iOS 1.0.16 is in Apple review (usually 1–3 days) — hang tight, or use the extension/Android wallet in the meantime. Live version status at [byoky.com](https://byoky.com).

## Quick Start

### For Users

**Chrome:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/byoky/igjohldpldlahcjmefdhlnbcpldlgmon) — store listing is at v0.5.4; v0.7.0 is still in review. For the latest features today, [build from source and load unpacked](INSTALL.md#chrome-install-from-source).

**Firefox:** [Install from Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/byoky/) — **v0.7.0 live now**

**iOS:** [Install from App Store](https://apps.apple.com/app/byoky/id6760779919) — wallet + Safari extension in one app. v1.0.16 is queued for Apple review (1–3 days); v1.0.12 is live. Patience, or use the Android/Firefox wallet while you wait.

**Android:** [Install from Google Play](https://play.google.com/store/apps/details?id=com.byoky.app) — **v1.0.16 live now** (standalone wallet; pair Chrome Android via QR or relay)

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

> **Two lines changed.** Full API compatibility. Streaming, file uploads, and vision all work. Keys never exposed. Sessions auto-reconnect if the extension restarts.

### Mobile Wallet (No Extension Needed)

No browser extension? Users can connect with the Byoky iOS or Android app instead. The SDK connects via relay — showing a pairing code that the user scans with their phone.

```
Web App ←WebSocket→ Relay Server ←WebSocket→ Phone Wallet → LLM API
```

With `modal: true`, the connect modal automatically detects whether the extension is installed. If not, it falls back to relay mode and shows a built-in QR code for mobile pairing — no custom UI needed. Both iOS and Android apps run the same translation engine, so cross-provider routing works on mobile too.

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

### Token Pool

**[byoky.com/token-pool](https://byoky.com/token-pool)** — A public board where users share free token gifts with the community. Browse available gifts, see which are online, check remaining tokens and expiry, and redeem directly into your wallet.

**How to list a gift:**
1. Create a gift in your wallet (extension or mobile)
2. Check "List on Token Pool"
3. Add a display name (or stay anonymous)
4. Your gift appears on the token pool for anyone to redeem

The token pool shows live online/offline status (green/red dot), remaining token budget, and expiration countdown. Expired and depleted gifts appear in a grayed-out section.

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
| OpenRouter | ✓ | — | Available |
| Azure OpenAI | ✓ | — | Available |
| *Custom* | ✓ | — | Extensible |

> **Setup Token**: Use your Claude Pro/Max subscription via `claude setup-token`. API keys use pay-per-use billing from the provider console.

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
│   └── web/           # Landing page (byoky.com) + MiniApps + Developer Hub
├── e2e/               # Playwright cross-device tests (Chrome + iOS + Android)
└── marketing/         # Screenshot + composite + video pipeline (gitignored outputs)
```

## Marketing pipeline

`marketing/` contains a self-contained pipeline that generates every asset
needed for the Chrome Web Store, Firefox AMO, iOS App Store, Google Play, and
Product Hunt — plus narrated walkthrough videos — by reusing the e2e Playwright
fixtures and the iOS/Android simulators the e2e suite already drives.

```bash
pnpm marketing:install                  # one-time: Sharp, Playwright, Chromium
pnpm marketing:desktop                  # Chrome + web + composites + narration + video
pnpm marketing:capture:ios              # requires booted iOS simulator
pnpm marketing:capture:android          # requires adb-visible emulator
pnpm marketing:all                      # end-to-end
```

**What gets generated** (all under `marketing/`, gitignored):
- `raw/popup-frames/*.png` — Chrome extension popup states (16 screens)
- `raw/web/*.png` — landing / demo / chat / marketplace hero + store shots
- `raw/ios/*.png` — native iOS simulator captures @ 1320×2868 (App Store 6.9″)
- `raw/android/*.png` — Android emulator captures @ 1080×1920 (Play portrait)
- `composites/*.png` — 6 Chrome/Firefox store slides · 6 iOS App Store slides ·
  Chrome promo small (440×280) + marquee (1400×560) · Product Hunt cover
  (1270×760) + header (1200×630) + thumb (240×240) · multi-screen eye-catcher
  (1920×1080)
- `voiceover/narration.wav` — Gemini 2.5 Flash TTS (Puck voice) with
  per-segment style direction
- `videos/walkthrough.mp4` — 16:9 narrated walkthrough (+ square + vertical)
- `videos/product-hunt.mp4` — Product Hunt launch variant (+ square + vertical)
- `videos/walkthrough-batman.mp4` — punchy Batman-TV-style remix with
  comic-book starburst overlays (POW! BAM! ZOOM!), hard zoom punches, screen
  shake, and color-flash transitions between beats

**Key design decisions:**
- iOS marketing capture runs [`ByokyMarketingTests.swift`](packages/ios/ByokyUITests/ByokyMarketingTests.swift)
  — a slim XCUITest that walks the app through every store-worthy screen and
  pauses at sentinel files so a parallel bash runner can snap via
  `xcrun simctl io screenshot`.
- Videos use `scale+lanczos+eval=frame` for sub-pixel smooth Ken-Burns motion
  (ffmpeg's `zoompan` rounds crop offsets to integers, producing visible 1px
  wobble — avoided here).
- Aspect-ratio variants (1:1 square, 9:16 vertical) preserve the full 16:9
  content with a blurred-fill background behind the letterbox bars, not a
  hard center-crop.

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
- [x] Android app (standalone wallet + relay pairing)
- [x] create-byoky-app CLI scaffolder
- [x] Alias groups — drag apps between groups to swap which credential they use
- [x] Setup token compatibility for third-party agents (OpenClaw etc.) — transparent tool name + system prompt rewriting
- [x] Cross-provider translation — drag an app from a Claude group to a GPT group and have requests transparently rewrite (request body, response body, SSE streams)
- [x] Remote OpenClaw via relay (cloud deployment, zero key exposure)
- [x] App Ecosystem — curated marketplace, in-wallet app runtime (sandboxed iframe/WebView), developer submission flow
- [x] Token Pool — public gift board where users share free tokens with the community
- [x] Mobile gift hosting — iOS and Android wallets serve gifts from the phone (previously extension-only)
- [x] Cross-provider translation for gifts — gift an Anthropic key, recipient can call it from the OpenAI SDK (or vice versa)
- [x] Gifted credentials via bridge proxy — CLI/desktop apps can use gifts through `@byoky/bridge`
- [ ] Password change (re-encrypt vault with new master password)

## App Ecosystem

**[byoky.com/apps](https://byoky.com/apps)** — A curated marketplace of apps that run on your own API keys. Install apps directly into your wallet (extension or mobile), and they run inside a sandboxed iframe/WebView — your keys never leave the wallet.

**How it works:**
1. Browse the App Store from the **Apps** tab in your wallet
2. Install an app — it appears as an icon on your app grid (iPhone-style)
3. Tap to launch — the app runs inside the wallet in a sandboxed environment
4. The app uses `@byoky/sdk` to request provider access — you approve which providers it can use
5. All API calls are proxied through the wallet — keys never touch the app

**For developers:**
```bash
npx create-byoky-app my-app    # scaffold a new app
npx create-byoky-app init      # create a byoky.app.json manifest
npx create-byoky-app submit    # submit to the marketplace
```

Or submit via the web form at [byoky.com/apps/submit](https://byoky.com/apps/submit).

**Security model:**
- Apps run in a sandboxed iframe (`allow-scripts allow-forms`) or WKWebView/WebView
- Cross-origin isolation prevents access to wallet storage, DOM, or keys
- Apps can only communicate via the SDK's `postMessage` bridge
- Users can disable or uninstall apps at any time
- Per-app usage tracking and provider access controls

**Hosting requirement:** your app URL must allow iframe embedding. Don't set `X-Frame-Options: DENY`/`SAMEORIGIN`; either omit CSP `frame-ancestors` or set it to `*` (or include the Byoky extension origin). The submission API verifies this automatically.

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
