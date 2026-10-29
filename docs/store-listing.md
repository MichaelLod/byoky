# Store listing copy

Listing text for the local-only Byoky. Store consoles don't read this file. Paste each block into the matching field. Character counts are noted where the store enforces a limit.

**Never name another brand in store text, the extension manifest or store release notes** ("MetaMask" above all). Mozilla disabled the Firefox add-on within a minute of its listing calling Byoky "the MetaMask for API keys" (2026-10-24). Stores block crypto-wallet impersonation automatically, and Google Play can strike the whole developer account. The tagline is fine on byoky.com and GitHub.

---

## Shared long description

Use it as-is for the Chrome Web Store and Firefox Add-ons. The App Store and Google Play versions below swap in the mobile-specific bullets.

```
Byoky is a wallet for your AI API keys.

Stop pasting API keys into every app. Byoky keeps your OpenAI, Anthropic, Gemini and other AI keys in one encrypted wallet. Apps connect to the wallet, you approve, and Byoky makes the API calls for them. The app never sees your key.

ONE WALLET, EVERY PROVIDER
Anthropic (API keys and Claude setup tokens), OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks, OpenRouter, Azure OpenAI, plus any OpenAI-compatible endpoint.

YOU STAY IN CONTROL
• Every app asks before it connects. Approve once, or trust a site.
• See every connected app and every request it makes.
• Set token allowances per app and per provider.
• Revoke access with one click.

GROUPS AND CROSS-PROVIDER ROUTING
Put apps in groups ("Work", "Personal") and pin each group to a key. Drag an app from a Claude group to a GPT group and Byoky translates requests and streaming responses on the fly. The app doesn't change a line.

WORKS WITH YOUR TOOLS
The open-source Byoky bridge lets Claude Code, OpenClaw and other CLI tools use your wallet through a localhost proxy. Your keys stay in the extension.

NO SERVERS
No account. No cloud. No telemetry. Keys are encrypted on your device with AES-256-GCM, using a key derived from your password. Requests go straight from your wallet to the provider. To move keys to another device, export a password-protected .byoky file.

OPEN SOURCE
Every line is MIT-licensed on GitHub: github.com/MichaelLod/byoky

FOR DEVELOPERS
Add "Connect with Byoky" to your app in two lines with @byoky/sdk and keep using the official OpenAI, Anthropic or Gemini SDKs. byoky.com/docs
```

---

## Chrome Web Store

**Summary** (≤132 chars):

```
Keep your AI API keys in one encrypted wallet. Apps connect to it and never see the key. No account, no cloud, open source.
```

**Description:** the shared long description above.

**Privacy practices tab**
- Single purpose: "Store the user's AI API keys locally and proxy API requests from apps the user approves, so apps never receive the keys."
- Data usage: certify that Byoky collects **no** user data. Keys and request logs never leave the device except as requests to the provider the user configured.
- Permission justifications:
  - `storage`: encrypted credentials and wallet settings.
  - `sidePanel`: the wallet UI in the side panel.
  - `nativeMessaging`: talk to the local `@byoky/bridge` for CLI tools.
  - `alarms`: a once-a-minute check that locks the wallet after the idle timeout and restarts the local bridge for CLI tools if it stopped.
  - No `identity` justification: 1.1.1 dropped that permission, so delete any text left for it.
  - host permissions: the AI provider APIs the wallet proxies to.
- Remove any justification text that mentions vault.byoky.com, relay.byoky.com, gifts or the token pool.

## Firefox Add-ons

**Summary** (≤250 chars):

```
Keep every AI API key in one encrypted wallet in your browser. Apps connect to it, you approve, and Byoky makes the calls. Your keys never leave the extension. No account, no cloud, open source.
```

**Description:** the shared long description above.

---

## Apple App Store (iOS)

**Subtitle** (≤30 chars; shared with the Mac app):

```
Wallet for your AI API keys
```

**Promotional text** (≤170 chars):

```
Keep every AI API key in one encrypted wallet. Apps connect to it, and your keys never leave your iPhone. No account, no cloud, open source.
```

**Description:**

```
Byoky is a wallet for your AI API keys.

Keep your OpenAI, Anthropic, Gemini and other AI keys in one encrypted wallet on your iPhone or iPad. Apps connect to the wallet, you approve, and Byoky makes the API calls for them. The app never sees your key.

WORKS IN SAFARI
The Byoky Safari extension brings the wallet to Safari. Add keys in its popup, and websites that support Byoky can use them, just like the desktop extension.

BUILT-IN BROWSER
Open any web app inside Byoky by its address. It connects to your wallet automatically, with no extension needed.

ONE WALLET, EVERY PROVIDER
Anthropic (API keys and Claude setup tokens), OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks, OpenRouter, Azure OpenAI and custom endpoints.

YOU STAY IN CONTROL
• Approve every app before it connects.
• See every request and token count.
• Set allowances, and revoke access any time.
• Groups and cross-provider routing: move an app from Claude to GPT without the app changing a line.

NO SERVERS
No account. No cloud. No tracking. Keys are encrypted and stored in the iOS Keychain. Requests go straight from your phone to the provider. Move keys between devices with password-protected .byoky backup files.

OPEN SOURCE
MIT-licensed on GitHub: github.com/MichaelLod/byoky
```

**Keywords** (≤100 chars; no provider names, since Apple's guideline 2.3.7 bars other companies' trademarks in keywords):

```
api key,ai,llm,wallet,byok,developer,safari extension,proxy,encryption,privacy,local,keys
```

**App Privacy (nutrition label):** "Data Not Collected." Before submitting, remove any data types declared for cloud vault accounts (e.g. user ID or username), gifts or pairing.

**What's New** for the first local-only version: see "Release notes" below.

## Apple App Store (macOS)

The Mac app is the container for the Safari extension, so its text is the extension's, minus the bridge (Chrome and Firefox only). Keywords and subtitle are the iOS ones. Its first version (1.1.0) can't have "What's New".

**Promotional text** (≤170 chars):

```
Keep every AI API key in one encrypted wallet in Safari. Websites connect to it, and your keys never leave your Mac. No account, no cloud, open source.
```

**Description:**

```
Byoky is a wallet for your AI API keys, in Safari on your Mac.

Stop pasting API keys into every app. Byoky keeps your OpenAI, Anthropic, Gemini and other AI keys in one encrypted wallet. Websites connect to the wallet, you approve, and Byoky makes the API calls for them. The site never sees your key.

ONE WALLET, EVERY PROVIDER
Anthropic (API keys and Claude setup tokens), OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks, OpenRouter, Azure OpenAI, plus any OpenAI-compatible endpoint.

YOU STAY IN CONTROL
• Every site asks before it connects. Approve once, or trust a site.
• See every connected app and every request it makes.
• Set token allowances per app and per provider.
• Revoke access with one click.

GROUPS AND CROSS-PROVIDER ROUTING
Put apps in groups ("Work", "Personal") and pin each group to a key. Drag an app from a Claude group to a GPT group and Byoky translates requests and streaming responses on the fly. The app doesn't change a line.

NO SERVERS
No account. No cloud. No telemetry. Keys are encrypted on your Mac with AES-256-GCM, using a key derived from your password. Requests go straight from your wallet to the provider. To move keys to another device, export a password-protected .byoky file.

GETTING STARTED
Open Byoky once, then turn on the Byoky extension in Safari Settings > Extensions.

OPEN SOURCE
Every line is MIT-licensed on GitHub: github.com/MichaelLod/byoky
```

## Google Play

**App name** (≤30 chars):

```
Byoky: AI API Key Wallet
```

**Short description** (≤80 chars):

```
One encrypted wallet for your AI API keys. Apps never see the keys.
```

**Full description:**

```
Byoky is a wallet for your AI API keys.

Keep your OpenAI, Anthropic, Gemini and other AI keys in one encrypted wallet on your phone. Apps connect to the wallet, you approve, and Byoky makes the API calls for them. The app never sees your key.

BUILT-IN BROWSER
Open any web app inside Byoky by its address. It connects to your wallet automatically, with no extension needed.

ONE WALLET, EVERY PROVIDER
Anthropic (API keys and Claude setup tokens), OpenAI, Google Gemini, Mistral, Cohere, xAI, DeepSeek, Perplexity, Groq, Together AI, Fireworks, OpenRouter, Azure OpenAI and custom endpoints.

YOU STAY IN CONTROL
• Approve every app before it connects.
• See every request and token count.
• Set allowances, and revoke access any time.
• Groups and cross-provider routing: move an app from Claude to GPT without the app changing a line.

NO SERVERS
No account. No cloud. No tracking. Keys are encrypted with Android Keystore-backed storage. Requests go straight from your phone to the provider. Move keys between devices with password-protected .byoky backup files.

OPEN SOURCE
MIT-licensed on GitHub: github.com/MichaelLod/byoky
```

**Data safety form:** no data collected, no data shared. "Data is encrypted in transit": yes, requests to providers use HTTPS. Account creation: none. Remove anything previously declared for cloud vault accounts.
Permissions: re-check the declarations against the final manifest. If the camera was only used for pairing/gift QR codes, it's gone.

---

## Release notes (first local-only version)

Keep these short. The App Store and Play limits are generous, but users skim.

```
Byoky is now fully local.
• Your keys live only on your device. No account, no cloud, no relay.
• New: move keys between devices with encrypted .byoky backup files.
• Removed: cloud sync, gifts, the token pool, phone pairing and the in-app app store. On mobile, open any web app by its address instead.
Keys already on this device are untouched.
```

---

## Website and social

- byoky.com hero: "The MetaMask for API keys."
- Repo description on GitHub (Settings → About): "The MetaMask for API keys: a local, open-source wallet for your AI credentials. Apps connect, and keys never leave Byoky."
- GitHub topics: `byok`, `api-keys`, `wallet`, `llm`, `openai`, `anthropic`, `gemini`, `browser-extension`, `ios`, `android`, `local-first`.
