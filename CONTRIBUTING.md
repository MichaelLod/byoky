# Contributing to byoky

Thanks for your interest in contributing! Here's how to get started.

## Setup

```bash
git clone https://github.com/MichaelLod/byoky.git
cd byoky
pnpm install
pnpm dev  # Start extension in Chrome dev mode
```

## Project structure

| Package | Description |
|---------|-------------|
| `packages/core` | Shared types, crypto, protocol, provider registry |
| `packages/sdk` | `@byoky/sdk` — npm package for developers |
| `packages/extension` | Browser extension (WXT + React + Zustand) |
| `packages/web` | Landing page (Next.js) |

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure everything builds: `pnpm build`
4. Open a pull request

## Adding a new provider

1. Add the provider config to `packages/core/src/providers.ts`
2. Add any provider-specific header logic in `packages/extension/entrypoints/background.ts` (`buildHeaders` function)
3. Update the provider list in the landing page and README

## Code style

- TypeScript strict mode
- No default exports (except where WXT requires them)
- Functional React components

## Security

If you discover a security vulnerability, please report it privately via [GitHub Security Advisories](https://github.com/MichaelLod/byoky/security/advisories/new) rather than opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
