# byoky

## Project structure

Monorepo using pnpm workspaces:

- `packages/core` — shared types, crypto (Web Crypto API), message protocol, provider registry, cross-provider translation
- `packages/sdk` — `@byoky/sdk` npm package for developers (includes `@byoky/sdk/server` for backend relay over the app's own WebSocket)
- `packages/extension` — browser extension built with WXT (Chrome, Firefox, Safari)
- `packages/bridge` — `@byoky/bridge` local HTTP proxy + native messaging host for CLI/desktop apps
- `packages/ios` — iOS app (SwiftUI wallet + Safari extension + in-wallet browser)
- `packages/android` — Android app (Kotlin/Compose wallet + in-wallet browser)
- `packages/openclaw-plugin` — OpenClaw provider plugin that routes through `@byoky/bridge`
- `packages/create-byoky-app` — `npx create-byoky-app` scaffolder
- `packages/web` — `byoky.com` Next.js site: landing page, `/docs`, `/demo`, `/chat`

## Development

- `pnpm install` — install all dependencies
- `pnpm dev` — start extension in Chrome dev mode
- `pnpm build` — build all packages
- `pnpm typecheck` — type check all packages

## Architecture

- **Local only**: no byoky-hosted services: no accounts, cloud sync, relay, gifts or app registry. Each wallet serves apps on its own device; the wallets talk only to the AI providers the user adds. Don't reintroduce a server dependency.
- **Proxy model**: API keys never leave the wallet. The extension's background script (and the mobile apps' native code) proxies all LLM API calls.
- **Custom fetch**: SDK provides `createFetch()` that routes requests through the extension via `window.postMessage` → content script → `chrome.runtime.Port` → background script.
- **Encryption**: AES-256-GCM with PBKDF2 key derivation (600K iterations), using Web Crypto API.
- **State**: Zustand in the popup, `browser.storage.local` for persistence.
- **Streaming**: Uses `chrome.runtime.Port` for long-lived connections; chunks forwarded via `TransformStream`.

## Conventions

- TypeScript strict mode
- WXT convention for entrypoints (`entrypoints/` directory)
- React functional components in popup
- No default exports except where WXT requires them
