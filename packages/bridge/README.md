# @byoky/bridge

Local HTTP proxy that lets CLI tools and desktop apps route LLM API calls through the Byoky browser extension. Keys never leave the extension.

```
CLI App → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

## Install

```bash
npm install -g @byoky/bridge
byoky-bridge install
```

`byoky-bridge install` registers the native messaging host with Chrome, Chromium, Brave, and Firefox.

If you're developing with an unpacked extension, pass your extension ID:

```bash
byoky-bridge install --extension-id <your-extension-id>
```

## How it works

The bridge runs automatically when the Byoky extension needs it (via native messaging). When a CLI tool or the OpenClaw plugin initiates a connection, the extension starts the bridge's HTTP proxy on `127.0.0.1`. Requests hit the proxy, get relayed to the extension over native messaging, and the extension injects the real API key before calling the provider API.

The bridge is a dumb relay — it never sees your API keys.

## Usage

The bridge is typically started by the extension, not manually. Once running, it exposes:

- **Health check:** `GET http://127.0.0.1:19280/health`
- **API proxy:** `POST http://127.0.0.1:19280/<provider>/...`

Example:

```bash
curl http://127.0.0.1:19280/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: byoky-proxy" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `byoky-bridge install` | Register native messaging host with browsers |
| `byoky-bridge uninstall` | Remove native messaging registration |
| `byoky-bridge status` | Check registration status |

## Supported Providers

Anthropic, OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks AI, OpenRouter, Azure OpenAI.

## License

[MIT](../../LICENSE)
