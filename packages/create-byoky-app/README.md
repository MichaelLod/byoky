# create-byoky-app

Scaffold a new app powered by [Byoky](https://byoky.com). Choose a template, get a working project with wallet integration out of the box.

## Usage

```bash
npx create-byoky-app
```

Or with a project name:

```bash
npx create-byoky-app my-ai-app
```

The CLI prompts you to pick a template, then generates the project and prints next steps.

## Templates

### AI Chat (Next.js)

Streaming chat built on the Anthropic SDK with Byoky's proxied fetch.

- Next.js 15 + React
- Streaming responses via `client.messages.stream()`
- Connection status and disconnect

### Multi-Provider (Vite)

Minimal setup showing how to connect several providers at once.

- Vite + vanilla TypeScript
- Requests Anthropic, OpenAI, and Gemini (all optional)
- Test buttons for each connected provider

### Backend Relay (Express)

Server-side LLM calls through the user's wallet. The server never sees API keys.

- Express + Vite (dual server)
- `ByokyServer` handles WebSocket relay
- `/api/generate` endpoint for proxied LLM requests
- Requests Anthropic, OpenAI, and Gemini (all optional); the server calls the first one available

## What You Get

```
my-ai-app/
  package.json
  tsconfig.json
  src/
    ...template files
  README.md
```

Run `npm install && npm run dev` and you're live.

## License

[MIT](../../LICENSE)
