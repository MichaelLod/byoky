# @byoky/core

Shared building blocks for [Byoky](https://byoky.com), the MetaMask for API keys. It's used by the browser extension, the SDK, the bridge and (as a bundled translation layer) the iOS and Android wallets.

Most app developers want [`@byoky/sdk`](https://www.npmjs.com/package/@byoky/sdk) instead. Reach for `@byoky/core` when you're building wallet-side tooling or need the types directly.

## What's inside

- **Types and protocol:** credentials, sessions, groups, connect requests/responses, and the `BYOKY_*` message protocol between apps and wallets.
- **Provider registry:** `PROVIDERS`, `getProvider()` and `getProviderIds()` for Anthropic, OpenAI, Gemini, Mistral, Cohere and the other supported providers.
- **Crypto:** `encrypt()` / `decrypt()` with AES-256-GCM and a PBKDF2-SHA256 (600,000 iterations) derived key, via the Web Crypto API. The output format (`base64(salt ‖ iv ‖ ciphertext+tag)`) is shared with the mobile wallets and `.byoky` backup files.
- **Proxy safety:** `validateProxyUrl()` and header helpers that keep a credential pinned to its own provider.
- **Cross-provider translation:** request, response and SSE stream translation between the Anthropic, OpenAI, Gemini and Cohere API families, used by group routing.
- **Backend relay messages:** the WebSocket message types behind `@byoky/sdk/server`.
- **Password strength:** the checker used for wallet and backup passwords.

## Install

```bash
npm install @byoky/core
```

## License

MIT
