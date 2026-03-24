# {{PROJECT_NAME}}

AI chat app powered by [Byoky](https://byoky.com) — use your own API keys without exposing them to websites.

## Setup

1. Install the [Byoky wallet extension](https://byoky.com) and add your Anthropic API key
2. Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000)
4. Click **Connect Wallet** and approve the connection
5. Start chatting

## How it works

- The app uses `@byoky/sdk` to connect to your Byoky wallet
- API calls are proxied through the wallet extension — your API key never leaves the extension
- Streaming responses are powered by the Anthropic SDK with a custom `fetch` from Byoky

## Learn more

- [Byoky Documentation](https://byoky.com/dev)
- [Next.js Documentation](https://nextjs.org/docs)
