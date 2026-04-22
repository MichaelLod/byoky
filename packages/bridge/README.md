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

## Connect (Claude Code / generic CLI)

One command to open the wallet, approve a session, and start the HTTP proxy on `127.0.0.1:19280`:

```bash
byoky-bridge connect
```

It opens a browser tab on an ephemeral loopback port, runs the Byoky SDK connect flow, and asks the extension to open the proxy. Once you approve in the Byoky popup the CLI prints:

```
✓ Bridge listening on http://127.0.0.1:19280
  Providers: anthropic
```

The proxy stays up as long as your browser is running — the extension's service worker holds the native-messaging port open. Re-run `byoky-bridge connect` after a browser restart.

Point your client at it:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
export ANTHROPIC_AUTH_TOKEN=byoky  # any non-empty value; bridge strips the header
claude
```

Options:

```bash
byoky-bridge connect --port 19280 --providers anthropic
# comma-separated for multi-provider:
byoky-bridge connect --providers anthropic,openai
```

## How it works

The bridge is a native messaging host — Chrome spawns it as a subprocess when the extension needs it. When `byoky-bridge connect` runs, the extension sends a `start-proxy` message telling the bridge to listen on `127.0.0.1:<port>`. Requests hit the proxy, get relayed to the extension over native messaging, and the extension injects the real API key before calling the provider API.

The bridge never sees your API keys.

## Usage from the browser

The bridge is also started by pages that use the Byoky SDK (OpenClaw plugin, etc.) — no CLI action needed in that flow. See `@byoky/sdk`.

Once running, the HTTP surface is:

- **Health check:** `GET http://127.0.0.1:19280/health` → `{"status":"ok","providers":[...]}`
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
| `byoky-bridge connect` | Open browser, approve a session, start the proxy on `:19280` |
| `byoky-bridge relay` | Run the proxy against a mobile wallet via the Byoky relay |

## Supported Providers

Anthropic, OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks AI, OpenRouter, Azure OpenAI.

## License

[MIT](../../LICENSE)
