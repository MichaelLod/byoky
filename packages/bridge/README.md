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

`byoky-bridge install` registers the native messaging host with Chrome, Chromium, Brave, and Firefox on macOS and Linux. Windows isn't supported yet.

Only the Chrome Web Store extension (and Firefox's `byoky@byoky.com`) may launch the bridge. For an unpacked build of this repo, add `--dev`; for any other ID, pass it:

```bash
byoky-bridge install --dev
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

Point your client at it, with the bridge token as the API key:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
export ANTHROPIC_API_KEY=$(byoky-bridge token)
# Use ANTHROPIC_API_KEY, not ANTHROPIC_AUTH_TOKEN — API_KEY is what Claude Code's
# first-run wizard checks to skip the OAuth login prompt.
claude
```

Options:

```bash
byoky-bridge connect --port 19280 --providers anthropic
# comma-separated for multi-provider:
byoky-bridge connect --providers anthropic,openai
```

## Bridge token

Every request to the proxy must carry the bridge token, so other programs on your machine can't spend your keys. `byoky-bridge token` prints it; it's created on first use at `~/.byoky-bridge/token` (mode 0600) and stays the same across restarts, so you configure clients once.

Send it wherever your client puts an API key: `x-api-key`, `Authorization: Bearer <token>`, `x-goog-api-key` or `api-key`. A missing or wrong token gets a 401 with `"code":"bridge_token_invalid"`. The bridge strips the header before the request goes on; the extension injects the real credential.

To rotate it, run `rm ~/.byoky-bridge/token && byoky-bridge connect`, then update your clients.

## How it works

The bridge is a native messaging host — Chrome spawns it as a subprocess when the extension needs it. When `byoky-bridge connect` runs, the extension sends a `start-proxy` message telling the bridge to listen on `127.0.0.1:<port>`. Requests hit the proxy, get relayed to the extension over native messaging, and the extension injects the real API key before calling the provider API.

The bridge never sees your API keys, and everything stays on your machine: the proxy only listens on `127.0.0.1` and talks to no Byoky-hosted service. It refuses requests that carry an `Origin` header, so web pages and other browser extensions can't call it; the Byoky extension itself talks to the bridge over native messaging only.

## Usage from the browser

The bridge is also started by pages that use the Byoky SDK (OpenClaw plugin, etc.) — no CLI action needed in that flow. See `@byoky/sdk`.

Once running, the HTTP surface is:

- **Health check:** `GET http://127.0.0.1:19280/health` → `{"status":"ok"}`; with the token, `{"status":"ok","providers":[...]}`
- **API proxy:** `POST http://127.0.0.1:19280/<provider>/...` (token required)

Example:

```bash
curl http://127.0.0.1:19280/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $(byoky-bridge token)" \
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
| `byoky-bridge install` | Register native messaging host with browsers (`--dev` adds the unpacked build) |
| `byoky-bridge uninstall` | Remove native messaging registration |
| `byoky-bridge status` | Check registration status |
| `byoky-bridge connect` | Open browser, approve a session, start the proxy on `:19280` |
| `byoky-bridge token` | Print the bridge token clients use as their API key |
| `byoky-bridge hermes-setup` | Patch `~/.hermes/config.yaml` so Hermes Agent routes through the bridge (writes the token as `api_key`) |

## Supported Providers

Anthropic, OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks AI, OpenRouter, Azure OpenAI.

## License

[MIT](../../LICENSE)
