# {{PROJECT_NAME}}

Multi-provider demo powered by [Byoky](https://byoky.com) — use Anthropic, OpenAI, and Gemini through a single wallet.

## Setup

1. Install the [Byoky wallet extension](https://byoky.com) and add your API keys
2. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

3. Open [http://localhost:5173](http://localhost:5173)
4. Click **Connect Wallet** and approve the connection
5. Test each connected provider

## How it works

- The app requests access to all three providers (all optional)
- Byoky shows which providers the user has configured
- Each provider gets its own `createFetch()` that proxies API calls through the wallet
- API keys never leave the extension

## Learn more

- [Byoky Documentation](https://byoky.com/dev)
- [Vite Documentation](https://vite.dev)
