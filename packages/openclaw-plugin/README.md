# @byoky/openclaw-plugin

[OpenClaw](https://openclaw.ai) provider plugin that routes LLM API calls through your Byoky browser wallet. API keys never leave the extension; a Claude setup token is handed to the local bridge for each request, because Anthropic needs a non-browser client for it (see the [bridge README](../bridge/README.md#how-it-works)).

```
OpenClaw → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

## Setup

**1. Install the plugin**:

```bash
openclaw plugins install @byoky/openclaw-plugin
```

OpenClaw loads plugins from `~/.openclaw/extensions` (not the global npm prefix), so use OpenClaw's own installer. It pulls `@byoky/bridge` in automatically, and the plugin registers the native messaging host on first `auth login`.

**2. Connect your wallet**:

```bash
openclaw models auth login --provider byoky-anthropic
```

This opens your browser. Unlock your Byoky wallet and approve the connection. The bridge starts automatically, and the plugin configures OpenClaw with the bridge token from `~/.byoky-bridge/token`, so there's no key to paste.

**3. Done.** OpenClaw now routes API calls through your wallet:

```bash
# Verify the bridge is running
curl -H "x-api-key: $(byoky-bridge token)" http://127.0.0.1:19280/health
# → {"status":"ok","providers":["anthropic"]}
```

## Available Providers

The plugin registers all 15 Byoky providers with OpenClaw:

| Provider | OpenClaw ID | Models |
|----------|-------------|--------|
| Anthropic | `byoky-anthropic` | Claude Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1, Opus 4.7, Sonnet 4.6, Haiku 4.5 |
| OpenAI | `byoky-openai` | GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.4 Nano |
| Google Gemini | `byoky-gemini` | Gemini 3.8 Flash (2.5 Pro and 2.5 Flash for past users) |
| xAI | `byoky-xai` | Grok 3, Grok 3 Mini |
| DeepSeek | `byoky-deepseek` | DeepSeek V3, R1 |
| Mistral | `byoky-mistral` | Mistral Large |
| Groq | `byoky-groq` | Llama 3.3 70B |
| Cohere | `byoky-cohere` | Set model manually |
| Perplexity | `byoky-perplexity` | Set model manually |
| Together AI | `byoky-together` | Set model manually |
| Fireworks AI | `byoky-fireworks` | Set model manually |
| OpenRouter | `byoky-openrouter` | Set model manually |
| Azure OpenAI | `byoky-azure_openai` | Set your deployment name as the model |
| Ollama | `byoky-ollama` | Set model manually |
| LM Studio | `byoky-lm_studio` | Set model manually |

To connect a different provider:

```bash
openclaw models auth login --provider byoky-openai
openclaw models auth login --provider byoky-gemini
```

## Commands

The plugin adds an OpenClaw command:

```
/byoky    Show bridge status and connected providers
```

## How it works

1. The plugin registers Byoky providers in OpenClaw, each pointing to `http://127.0.0.1:19280/<provider>`
2. When OpenClaw makes an API call, the request hits the local Byoky Bridge with the bridge token as its API key
3. The bridge checks the token and relays the request to the Byoky extension via native messaging
4. The extension injects the real API key and calls the provider API
5. The response streams back through the same path

Your API keys exist only inside the extension's encrypted local storage. Nothing passes through a Byoky-hosted service.

## License

[MIT](../../LICENSE)
