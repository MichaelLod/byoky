'use client';

import { useState } from 'react';

const AI_PROMPT = `You are helping me set up Claude Code (Anthropic's official CLI) to run on Byoky (https://byoky.com/claude-code).

Context:
- Byoky is a local BYOK wallet ("the MetaMask for API keys"). The browser extension holds my API keys (or a Claude Pro/Max setup token) and proxies every LLM request so keys never leave the wallet. Byoky runs no servers.
- The Byoky bridge is a tiny local HTTP proxy on 127.0.0.1:19280. Claude Code talks to the bridge, which forwards through native messaging to the extension, which calls Anthropic.
- I already have the Byoky browser extension installed (Chrome or Firefox) with an Anthropic credential loaded. Do not worry about that side.

Your job — run these commands on my machine and report each step:

1. Install Claude Code if I don't already have it:
     npm install -g @anthropic-ai/claude-code
   Verify with \`claude --version\`.

2. Install (or update to) the latest Byoky bridge and register the native messaging host:
     npm install -g @byoky/bridge@latest
     byoky-bridge install
   The install command writes a native messaging manifest that whitelists the Byoky extension. Restart the browser afterwards so Chrome picks it up.

3. Start the bridge proxy by connecting my wallet:
     byoky-bridge connect
   This opens a browser tab on http://127.0.0.1:<ephemeral>, I click "Connect wallet", approve the session in the Byoky popup, and the CLI reports "Bridge listening on http://127.0.0.1:19280". The bridge stays up as long as my browser is running — after a restart, re-run \`byoky-bridge connect\` to bring it back. If the CLI errors with "SDK failed to load", make sure I'm on @byoky/bridge@0.9.3 or later (\`byoky-bridge --help\` should list a \`connect\` command).

4. Point Claude Code at the local Byoky bridge. The bridge exposes Anthropic at /anthropic — every request is rewritten to api.anthropic.com on the other side. The API key must be the bridge token: the bridge rejects requests without it (so other programs on my machine can't use my keys), then strips it and the extension injects the real credential. Use \`ANTHROPIC_API_KEY\` (not AUTH_TOKEN) — that's what Claude Code's first-run wizard checks to skip the OAuth login prompt:
     export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
     export ANTHROPIC_API_KEY=$(byoky-bridge token)
   Add both lines to my shell profile (~/.zshrc or ~/.bashrc) exactly as written, with the \`$(byoky-bridge token)\` substitution. Never print the token, paste it into this chat, or write its literal value into a file.

5. Verify the bridge is up and Anthropic is in the provider list:
     curl -H "x-api-key: $(byoky-bridge token)" http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[..., "anthropic", ...]}
   If anthropic is missing, the wallet doesn't have an Anthropic credential — tell me to add one and stop.

6. Start Claude Code:
     claude
   Fresh-install note: if Claude Code shows an OAuth URL pointing to platform.claude.com, it's not reading the env vars. Check ANTHROPIC_API_KEY is set in this shell, delete ~/.claude.json (stale onboarding state), and retry.

Troubleshooting cheatsheet (only mention if the relevant error shows up):
- "Third-party apps now draw from your extra usage" → the wallet is not treating this as first-party Claude Code. This is usually because the credential is an API key, not an OAuth setup token. Ask me to run \`claude setup-token\` and paste the result into the wallet.
- "ECONNREFUSED 127.0.0.1:19280" → the bridge proxy isn't running. Run \`byoky-bridge connect\` (or re-run it if the browser was restarted).
- HTTP 401 "Missing or invalid bridge token" → ANTHROPIC_API_KEY isn't the bridge token in this shell. Re-export it with \`export ANTHROPIC_API_KEY=$(byoky-bridge token)\`.
- "invalid x-api-key" or "Invalid bearer token" → the wallet credential is bad or expired. Ask me to swap it.
- "rate_limit_error" → my Anthropic account is being throttled upstream. Wait a few minutes.
- Claude Code complains about missing model → override with \`--model claude-sonnet-4-5\` (or another model my plan has access to).

Rules:
- Run one command at a time and show me the output before moving on.
- If a global npm install fails with EACCES, suggest a per-user npm prefix fix — do NOT auto-sudo.
- Do not edit any files in my repo. This is an install task, not a code change.
- If a step errors, stop and ask me — do not keep retrying.
`;

export function InstallWithAI() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — fall through silently */
    }
  };

  return (
    <button
      type="button"
      className="btn"
      onClick={copy}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#1c1917', color: '#fff', border: 'none', minWidth: '220px', justifyContent: 'center' }}
    >
      <span style={{ fontSize: '14px' }}>✦</span>
      {copied ? 'Copied!' : 'Copy AI install prompt'}
    </button>
  );
}
