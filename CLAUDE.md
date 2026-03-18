# byoky

## Project structure

Monorepo using pnpm workspaces:

- `packages/core` — shared types, crypto (Web Crypto API), message protocol, provider registry
- `packages/sdk` — `@byoky/sdk` npm package for developers
- `packages/extension` — browser extension built with WXT (Chrome, Firefox, Safari)

## Development

- `pnpm install` — install all dependencies
- `pnpm dev` — start extension in Chrome dev mode
- `pnpm build` — build all packages
- `pnpm typecheck` — type check all packages

## Architecture

- **Proxy model**: API keys never leave the extension. Background script proxies all LLM API calls.
- **Custom fetch**: SDK provides `createFetch()` that routes requests through the extension via `window.postMessage` → content script → `chrome.runtime.Port` → background script.
- **Encryption**: AES-256-GCM with PBKDF2 key derivation (600K iterations), using Web Crypto API.
- **State**: Zustand in the popup, `browser.storage.local` for persistence.
- **Streaming**: Uses `chrome.runtime.Port` for long-lived connections; chunks forwarded via `TransformStream`.

## Conventions

- TypeScript strict mode
- WXT convention for entrypoints (`entrypoints/` directory)
- React functional components in popup
- No default exports except where WXT requires them
