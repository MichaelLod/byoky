# {{PROJECT_NAME}}

Backend relay demo powered by [Byoky](https://byoky.com) — make server-side LLM calls through the user's wallet.

## Setup

1. Install the [Byoky wallet extension](https://byoky.com) and add your API key(s)
2. Install dependencies:

```bash
npm install
```

3. Start both the server and client:

```bash
npm run dev
```

This starts:
- **Express server** on [http://localhost:3001](http://localhost:3001) (API + WebSocket relay)
- **Vite dev server** on [http://localhost:5173](http://localhost:5173) (frontend)

4. Open the frontend, click **Connect Wallet**, and try generating a response

## How it works

1. The browser connects to the Byoky wallet using `@byoky/sdk`
2. `session.createRelay(wsUrl)` opens a WebSocket to the Express server
3. The server uses `ByokyServer` to accept the connection and get a `ByokyClient`
4. `client.createFetch(providerId)` returns a fetch function that proxies API calls back through the user's wallet
5. The server makes LLM calls without ever seeing the user's API key

## Learn more

- [Byoky Documentation](https://byoky.com/dev)
- [Express Documentation](https://expressjs.com)
