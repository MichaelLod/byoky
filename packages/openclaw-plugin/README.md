# @byoky/openclaw-plugin

[OpenClaw](https://openclaw.ai) provider plugin that routes LLM API calls through your Byoky browser wallet. Keys never leave the extension.

```
OpenClaw → HTTP → Bridge (localhost) → Native Messaging → Extension → LLM API
```

## Setup

**1. Install the bridge** (one-time):

```bash
npm install -g @byoky/bridge
byoky-bridge install
```

**2. Install the plugin**:

```bash
npm install -g @byoky/openclaw-plugin
```

**3. Connect your wallet**:

```bash
openclaw models auth login --provider byoky-anthropic
```

This opens your browser. Unlock your Byoky wallet and approve the connection. The bridge starts automatically.

**4. Done.** OpenClaw now routes API calls through your wallet:

```bash
# Verify the bridge is running
curl http://127.0.0.1:19280/health
# → {"status":"ok","providers":["anthropic"]}
```

## Available Providers

The plugin registers all 15 Byoky providers with OpenClaw:

| Provider | OpenClaw ID | Models |
|----------|-------------|--------|
| Anthropic | `byoky-anthropic` | Claude Opus 4, Sonnet 4, Haiku 4.5 |
| OpenAI | `byoky-openai` | GPT-4.1, o3, o4-mini, GPT-4.1 Mini |
| Google Gemini | `byoky-gemini` | Gemini 2.5 Pro, 2.5 Flash |
| xAI | `byoky-xai` | Grok 3, Grok 3 Mini |
| DeepSeek | `byoky-deepseek` | DeepSeek V3, R1 |
| Mistral | `byoky-mistral` | Mistral Large |
| Groq | `byoky-groq` | Llama 3.3 70B |
| Cohere | `byoky-cohere` | Set model manually |
| Perplexity | `byoky-perplexity` | Set model manually |
| Together AI | `byoky-together` | Set model manually |
| Fireworks AI | `byoky-fireworks` | Set model manually |
| OpenRouter | `byoky-openrouter` | Set model manually |
| Replicate | `byoky-replicate` | Set model manually |
| Hugging Face | `byoky-huggingface` | Set model manually |
| Azure OpenAI | `byoky-azure_openai` | Set model manually |

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
2. When OpenClaw makes an API call, the request hits the local Byoky Bridge
3. The bridge relays the request to the Byoky extension via native messaging
4. The extension injects the real API key and calls the provider API
5. The response streams back through the same path

Your API keys exist only inside the extension's encrypted vault.

## License

[MIT](../../LICENSE)
