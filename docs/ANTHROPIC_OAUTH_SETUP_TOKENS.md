# Anthropic OAuth & Setup Token — Developer Reference

> Last verified: 2026-03-20 (Anthropic's behavior). Byoky's own handling checked against the code on 2026-11-02.

## Overview

Anthropic has three credential types for API access. Byoky accepts two of them: API keys (`authMethod: 'api_key'`) and setup tokens (`authMethod: 'oauth'`). The wallet (extension or mobile app) handles both; the SDK stays credential-type-agnostic. Byoky has no OAuth sign-in and never refreshes a token (see section 3).

## Credential Types

### 1. API Key (`sk-ant-api-...`)

- **Auth header:** `x-api-key: <key>`
- **Models:** All (current + legacy + aliases like `-latest`)
- **Expiry:** None
- **Billing:** API credits (pay-per-token)
- **Extra headers:** None required

### 2. Setup Token (`sk-ant-oat01-...`)

Created with `claude setup-token` (Claude Code CLI). Long-lived (~1 year), scoped to inference. The user pastes it into Add Credential in the wallet.

- **Auth header:** `Authorization: Bearer <token>`
- **Models:** Current generation only, by exact model id (e.g., `claude-sonnet-5-5`, `claude-opus-5-5`). **No aliases** (`-latest`), **no legacy models** (3.5, 3.0). The 2026-03-20 test used `claude-sonnet-4-20250514` and `claude-opus-4-20250514`, both retired on 2026-06-15.
- **Expiry:** ~1 year
- **Billing:** Claude Max/Pro subscription (weekly quota, not pay-per-token)
- **Extra headers:** Required (see below)
- **System prompt:** Required prefix (see below)

### 3. OAuth Access Token (`sk-ant-oat01-...`)

Obtained via browser OAuth flow (PKCE), the way Claude Code's own sign-in works. Short-lived (hours), refreshable.

- **Auth header:** `Authorization: Bearer <token>`
- **Models:** Same restrictions as Setup Token (assumed, pending verification)
- **Expiry:** Hours (requires refresh)
- **Billing:** Claude Max/Pro subscription
- **Extra headers:** Same as Setup Token
- **Refresh:** POST to `https://claude.ai/api/oauth/token` (Cloudflare-protected, browser-only). **Byoky doesn't implement this:** the dormant PKCE and refresh flow was removed in 1.1.1.

> **Note:** Setup Tokens and OAuth Tokens share the same `sk-ant-oat01-` prefix, and Byoky stores either as `authMethod: 'oauth'`. A pasted OAuth access token works until it expires a few hours later, then Anthropic answers 401. Use a setup token.

## Required Headers for OAuth/Setup Tokens

All requests using Bearer auth (`sk-ant-oat` tokens) **must** include these headers:

```http
Authorization: Bearer <token>
Content-Type: application/json
anthropic-version: 2023-06-01
anthropic-beta: claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14
user-agent: claude-cli/2.1.316
x-app: cli
anthropic-dangerous-direct-browser-access: true
```

The `user-agent` names a Claude Code release, and Anthropic refuses newer models to older ones with a 400 ("Claude Code 2.1.76 does not support this model; version 2.1.280 or newer is required" for `claude-opus-5-5`, 2026-11-01). Byoky sends `CLAUDE_CLI_USER_AGENT` (packages/core/src/proxy-utils.ts, and the same value in the iOS and Android apps); raise it to a current Claude Code release when a new model gets that 400.

### Required System Prompt

The first system message **must** start with:

```
You are Claude Code, Anthropic's official CLI for Claude.
```

Without this, requests return `400 Error`.

## What Happens Without Correct Headers

| Missing | Response |
|---------|----------|
| All Claude Code headers | `401` — "OAuth authentication is currently not supported." |
| Headers present, no system prompt | `400` — "Error" |
| All headers + system prompt | `200` ✅ |

## Model Availability Matrix

| Model | API Key | Setup/OAuth Token |
|-------|---------|-------------------|
| `claude-sonnet-4-20250514` | ✅ | ✅ |
| `claude-opus-4-20250514` | ✅ | ✅ |
| `claude-sonnet-4-latest` | ✅ | ❌ 404 |
| `claude-opus-4-latest` | ✅ | ❌ 404 |
| `claude-haiku-3-5-20241022` | ✅ | ❌ 404 |
| `claude-3-5-sonnet-20241022` | ✅ | ❌ 404 |
| `claude-3-opus-20240229` | ✅ | ❌ 404 |

These are the 2026-03-20 results. Every model in the table has been retired since (Claude Sonnet 4 and Opus 4 on 2026-06-15, the 3.x models earlier), so requests to them now fail with any credential. Current models use dateless ids such as `claude-sonnet-5-5` and `claude-opus-5-5`; they were not part of this test. Retirement dates: platform.claude.com/docs/en/about-claude/model-deprecations.

## Setup Token Path in Byoky

```
┌───────────────────────────────────────────────────┐
│ User runs `claude setup-token` and pastes the     │
│ token in Add Credential → encrypted in the wallet │
│ (authMethod: 'oauth')                             │
└─────────────┬─────────────────────────────────────┘
              │
              ▼
┌───────────────────────────────────────────────────┐
│ On an Anthropic request:                          │
│ • buildHeaders(): Bearer token + Claude Code      │
│   headers (CLAUDE_CLI_USER_AGENT, x-app, betas)   │
│ • rewriteToolNamesForClaudeCode() and             │
│   injectClaudeCodeSystemPrompt() shape the body   │
│   (a third-party system prompt moves into the     │
│   first user message)                             │
└─────────────┬─────────────────────────────────────┘
              │
              ▼
┌───────────────────────────────────────────────────┐
│ Chrome / Firefox: the extension hands the request │
│ to the Byoky Bridge (proxyViaBridge), which calls │
│ api.anthropic.com from Node, because Anthropic    │
│ needs a non-browser TLS client. No bridge, or     │
│ Safari: BRIDGE_UNAVAILABLE (HTTP 503).            │
│ iOS / Android: the app calls Anthropic natively.  │
└─────────────┬─────────────────────────────────────┘
              │
              ▼
┌───────────────────────────────────────────────────┐
│ Expired or revoked token: Anthropic's own 401     │
│ reaches the app. No refresh; the user pastes a    │
│ new token.                                        │
└───────────────────────────────────────────────────┘
```

## Byoky Architecture Implications

### SDK (credential-type-agnostic)

The SDK **never** sees raw credentials, and the app's code works the same with either credential type. It:
1. Connects to the wallet with `connect()`
2. Receives `ConnectResponse.providers` (`available`, `authMethod` per provider)
3. Sends requests through the wallet proxy (`session.createFetch()`)
4. Gets responses back

### Wallet (handles everything)

The extension (and the mobile apps, natively) detects the credential type and handles auth internally:

```typescript
// Extension-internal logic (not exposed to SDK)
if (credential.authMethod === 'oauth') {
  // Setup Token or pasted OAuth Token — same handling, no refresh
  headers['authorization'] = `Bearer ${decryptedToken}`;
  headers['user-agent'] = 'claude-cli/2.1.316'; // CLAUDE_CLI_USER_AGENT
  headers['x-app'] = 'cli';
  headers['anthropic-dangerous-direct-browser-access'] = 'true';
  headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20,...';
  // Claude Code tool names and system prompt (injectClaudeCodeSystemPrompt)
  body.system = [{ type: 'text', text: 'You are Claude Code...' }, ...body.system];
  // Then the request goes through the Byoky Bridge (desktop) or native code (mobile)
} else {
  // API Key — standard
  headers['x-api-key'] = decryptedKey;
}
```

### Connect Response

The wallet tells the SDK which providers it can serve and how, in `ConnectResponse.providers` (packages/core/src/types.ts). There is no model list; apps call `session.listModels()` for that.

```typescript
providers: {
  // API key credential
  anthropic: { available: true, authMethod: 'api_key' },
  // or, for a setup token:
  // anthropic: { available: true, authMethod: 'oauth' },
}
```

## Source

Discovered by reverse-engineering OpenClaw's `@mariozechner/pi-ai` Anthropic provider, which successfully uses Setup Tokens with these exact headers. Verified via live `curl` tests against `api.anthropic.com` on 2026-03-20.
