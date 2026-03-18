<p align="center">
  <br />
  <a href="https://byoky.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg">
      <img alt="byoky" src="https://github.com/MichaelLod/byoky/raw/main/.github/banner-dark.svg" width="480">
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
  <a href="https://github.com/MichaelLod/byoky/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MichaelLod/byoky?style=flat&color=7c3aed" alt="License" /></a>
  <a href="https://github.com/MichaelLod/byoky/stargazers"><img src="https://img.shields.io/github/stars/MichaelLod/byoky?style=flat&color=7c3aed" alt="Stars" /></a>
  <a href="https://github.com/MichaelLod/byoky/issues"><img src="https://img.shields.io/github/issues/MichaelLod/byoky?style=flat&color=7c3aed" alt="Issues" /></a>
  <a href="https://github.com/MichaelLod/byoky/pulls"><img src="https://img.shields.io/badge/PRs-welcome-7c3aed?style=flat" alt="PRs Welcome" /></a>
</p>

---

## What is byoky?

**byoky** (Bring Your Own Key) is an open-source browser extension that stores your AI API keys and OAuth tokens in an encrypted vault. Developers integrate via `@byoky/sdk` — their apps can use your credentials without ever seeing them.

- **For users** — One wallet for all your AI credentials. Add keys, approve apps, revoke access. Full visibility into every request.
- **For developers** — Two lines of code. Use your favorite provider SDK. Keys never touch your app.

### How it works

```
1. Install the byoky wallet → set a master password
2. Add your API keys or sign in via OAuth → encrypted locally
3. Visit any byoky-enabled app → approve access → keys stay in the vault
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

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});

// Use the native Anthropic SDK — just swap in byoky's fetch
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

## Security

| | |
|---|---|
| **AES-256-GCM** | Keys encrypted with PBKDF2-derived key (600K iterations) via Web Crypto API |
| **Zero exposure** | API keys never leave the extension. Apps get temporary session tokens |
| **Audit log** | Every request logged — app origin, provider, status, timestamp |
| **Local only** | No cloud. No telemetry. No tracking. Your device, your keys |

## Supported Providers

| Provider | API Key | OAuth | Status |
|----------|:-------:|:-----:|--------|
| Anthropic | ✓ | ✓ | Available |
| OpenAI | ✓ | — | Available |
| Google Gemini | ✓ | — | Available |
| *Custom* | ✓ | — | Extensible |

## Architecture

byoky uses a **proxy model** (like MetaMask's transaction signing). Keys never leave the extension:

```
App → SDK (createFetch) → window.postMessage → Content Script
  → chrome.runtime.Port → Background Script → fetch(real API + real key)
  → streams response back through the same chain
```

The SDK provides `createFetch()` — a drop-in `fetch` replacement that routes through the extension. Works with **any provider's native SDK**.

## Project Structure

```
byoky/
├── packages/
│   ├── core/          # Shared types, crypto, protocol, provider registry
│   ├── sdk/           # @byoky/sdk — npm package for developers
│   ├── extension/     # Browser extension (Chrome, Firefox, Safari) — WXT
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

- [ ] Claude OAuth flow (authorization code)
- [ ] Spending caps and rate limits per app
- [ ] Export/import encrypted vault backup
- [ ] Browser extension store listings
- [x] Landing page at [byoky.com](https://byoky.com)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — free forever.
