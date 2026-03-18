# byoky

**Bring Your Own Key** — A secure browser wallet for your AI credentials.

byoky lets users store API keys and OAuth tokens for LLM providers (Anthropic, OpenAI, Gemini, etc.) in a single, encrypted browser extension. Developers integrate via an SDK so their apps can use the user's credentials — without ever seeing them.

Think MetaMask, but for AI.

## How it works

1. **User** installs the byoky browser extension
2. **User** adds their API keys or signs in via OAuth
3. **Developer** integrates `@byoky/sdk` into their app
4. **App** requests access → user approves in the wallet popup
5. **App** makes API calls through byoky's proxy — keys never leave the extension

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});

// Use the native Anthropic SDK — just swap in byoky's proxy fetch
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

// Works exactly like normal, including streaming
const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Security model

- API keys are encrypted locally with AES-256-GCM (PBKDF2-derived key, 600K iterations)
- Keys **never leave the extension** — the extension proxies requests on behalf of apps
- Apps receive temporary, revocable session keys
- All requests are logged and visible to the user
- No cloud sync, no telemetry — everything stays on your device

## Project structure

```
byoky/
├── packages/
│   ├── core/          # Shared types, crypto, protocol
│   ├── sdk/           # @byoky/sdk — npm package for developers
│   └── extension/     # Browser extension (Chrome, Firefox, Safari)
```

## Development

```bash
# Install dependencies
pnpm install

# Start extension in dev mode (Chrome)
pnpm dev

# Start for Firefox
pnpm --filter @byoky/extension dev:firefox

# Build all packages
pnpm build

# Build extension for all browsers
pnpm --filter @byoky/extension build:all

# Type check
pnpm typecheck
```

### Loading the extension in Chrome

1. Run `pnpm dev`
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `packages/extension/.output/chrome-mv3`

## Architecture

### Proxy model

byoky uses a proxy architecture (like MetaMask's transaction signing). When an app makes an API call:

```
App → window.postMessage → Content Script → chrome.runtime.Port → Background Script
Background Script → fetch(LLM API with real credentials) → streams response back
Background Script → Content Script → window.postMessage → App
```

The background script is the only context that ever holds decrypted API keys.

### Custom fetch

The SDK provides a `createFetch()` function that returns a drop-in replacement for `fetch`. This means developers can use **any provider's native SDK** (Anthropic, OpenAI, etc.) — they just pass byoky's fetch as a custom transport:

```typescript
const client = new Anthropic({
  apiKey: session.sessionKey,     // byoky session key (not the real API key)
  fetch: session.createFetch('anthropic'),  // routes through the extension
});
```

### Supported providers

| Provider | API Key | OAuth |
|----------|---------|-------|
| Anthropic | Yes | Yes |
| OpenAI | Yes | — |
| Google Gemini | Yes | — |

More providers can be added by extending the provider registry in `@byoky/core`.

## Packages

### `@byoky/core`

Shared types, encryption utilities (Web Crypto API), message protocol, and provider definitions.

### `@byoky/sdk`

The developer-facing npm package. Provides the `Byoky` class for connecting to the wallet and `createFetch()` for proxying API calls through the extension.

### `@byoky/extension`

The browser extension built with [WXT](https://wxt.dev). Includes:

- **Popup UI** (React + Zustand) — manage credentials, approve connections, view history
- **Background script** — session management, request proxy, encryption
- **Content script** — message relay between web pages and the extension

## Roadmap

- [ ] Claude OAuth flow (authorization code)
- [ ] Spending caps and rate limits per app
- [ ] Multiple credential profiles (personal/work)
- [ ] Export/import encrypted vault backup
- [ ] Browser extension store listings (Chrome, Firefox, Safari)
- [ ] Landing page at [byoky.com](https://byoky.com)

## License

[MIT](LICENSE)
