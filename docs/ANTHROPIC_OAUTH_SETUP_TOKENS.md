# Anthropic OAuth & Setup Token — Developer Reference

> Last verified: 2026-03-20

## Overview

Anthropic supports three credential types for API access. Byoky must handle all three transparently in the extension layer, while the SDK remains credential-type-agnostic.

## Credential Types

### 1. API Key (`sk-ant-api-...`)

- **Auth header:** `x-api-key: <key>`
- **Models:** All (current + legacy + aliases like `-latest`)
- **Expiry:** None
- **Billing:** API credits (pay-per-token)
- **Extra headers:** None required

### 2. Setup Token (`sk-ant-oat01-...`)

Created via `claude login` CLI command. Long-lived (~1 year), scoped to inference.

- **Auth header:** `Authorization: Bearer <token>`
- **Models:** Current generation only with exact version names (e.g., `claude-sonnet-4-20250514`, `claude-opus-4-20250514`). **No aliases** (`-latest`), **no legacy models** (3.5, 3.0).
- **Expiry:** ~1 year
- **Billing:** Claude Max/Pro subscription (weekly quota, not pay-per-token)
- **Extra headers:** Required (see below)
- **System prompt:** Required prefix (see below)

### 3. OAuth Access Token (`sk-ant-oat01-...`)

Obtained via browser OAuth flow (PKCE). Short-lived (hours), refreshable.

- **Auth header:** `Authorization: Bearer <token>`
- **Models:** Same restrictions as Setup Token (assumed, pending verification)
- **Expiry:** Hours (requires refresh)
- **Billing:** Claude Max/Pro subscription
- **Extra headers:** Same as Setup Token
- **Refresh:** POST to `https://claude.ai/api/oauth/token` (Cloudflare-protected, browser-only)

> **Note:** Setup Tokens and OAuth Tokens share the same `sk-ant-oat01-` prefix. Differentiate by context (Setup Tokens have ~1 year expiry, OAuth tokens expire in hours and come with a refresh token).

## Required Headers for OAuth/Setup Tokens

All requests using Bearer auth (`sk-ant-oat` tokens) **must** include these headers:

```http
Authorization: Bearer <token>
Content-Type: application/json
anthropic-version: 2023-06-01
anthropic-beta: claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14
user-agent: claude-cli/2.1.76
x-app: cli
anthropic-dangerous-direct-browser-access: true
```

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

## OAuth Token Lifecycle

```
┌─────────────────────────────────────────────┐
│ User clicks "Connect Anthropic (OAuth)"     │
│ in Byoky extension popup                    │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ Extension opens claude.ai OAuth flow (PKCE) │
│ → User authorizes → callback with code      │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ Extension exchanges code for:               │
│ • accessToken (sk-ant-oat01-...)            │
│ • refreshToken (sk-ant-ort01-...)           │
│ • expiresAt (hours from now)                │
│ • scopes, subscriptionType, rateLimitTier   │
│ → Encrypted and stored in vault             │
└─────────────┬───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────┐
│ On API request:                             │
│ • Check expiresAt                           │
│ • If expired → refresh via claude.ai        │
│ • Inject Bearer + Claude Code headers       │
│ • Proxy to api.anthropic.com                │
└─────────────────────────────────────────────┘
```

## Byoky Architecture Implications

### SDK (credential-type-agnostic)

The SDK **never** sees raw credentials or knows the auth method. It:
1. Connects to extension with a Byoky Key
2. Receives capabilities (available providers, models)
3. Sends requests through the extension proxy
4. Gets responses back

### Extension (handles everything)

The extension detects credential type and handles auth internally:

```typescript
// Extension-internal logic (not exposed to SDK)
if (credential.authMethod === 'oauth') {
  // Setup Token or OAuth Token — same handling
  headers['authorization'] = `Bearer ${decryptedToken}`;
  headers['user-agent'] = 'claude-cli/2.1.76';
  headers['x-app'] = 'cli';
  headers['anthropic-dangerous-direct-browser-access'] = 'true';
  headers['anthropic-beta'] = 'claude-code-20250219,oauth-2025-04-20,...';
  // Prepend required system prompt
  body.system = [{ type: 'text', text: 'You are Claude Code...' }, ...body.system];
} else {
  // API Key — standard
  headers['x-api-key'] = decryptedKey;
}
```

### Capabilities Response

The extension tells the SDK what's available:

```typescript
// For API Key credential
{ available: true, models: ['*'], authMethod: 'api_key' }

// For Setup/OAuth credential  
{ available: true, models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514'], authMethod: 'oauth' }
```

## Source

Discovered by reverse-engineering OpenClaw's `@mariozechner/pi-ai` Anthropic provider, which successfully uses Setup Tokens with these exact headers. Verified via live `curl` tests against `api.anthropic.com` on 2026-03-20.
