'use client';

import { useState } from 'react';

const AI_PROMPT = `You are helping me set up Claude Code (Anthropic's official CLI) to run on Byoky (https://byoky.com/claude-code).

Context:
- Byoky is a BYOK wallet extension. It holds API keys (mine, gifted, or a Claude Pro/Max subscription token) and proxies every LLM request so keys never leave the wallet.
- The Byoky bridge is a tiny local HTTP proxy on 127.0.0.1:19280. Claude Code talks to the bridge, which forwards through native messaging to the extension, which calls Anthropic.
- I already have the Byoky wallet installed (Chrome/Firefox/iOS/Android) and an Anthropic credential or gift loaded. Do not worry about that side.

Your job — run these commands on my machine and report each step:

1. Install Claude Code if I don't already have it:
     npm install -g @anthropic-ai/claude-code
   Verify with \`claude --version\`.

2. Install the Byoky bridge (v0.9.3+) and register the native messaging host:
     npm install -g @byoky/bridge
     byoky-bridge install
   The install command writes a native messaging manifest that whitelists the Byoky extension. Restart the browser afterwards so Chrome picks it up.

3. Start the bridge proxy by connecting my wallet:
     byoky-bridge connect
   This opens a browser tab on http://127.0.0.1:<ephemeral>, I click "Connect wallet", approve the session in the Byoky popup, and the CLI reports "Bridge listening on http://127.0.0.1:19280". The bridge stays up as long as my browser is running — after a restart, re-run \`byoky-bridge connect\` to bring it back. If the CLI errors with "SDK failed to load", make sure I'm on @byoky/bridge@0.9.3 or later (\`byoky-bridge --help\` should list a \`connect\` command).

4. Point Claude Code at the local Byoky bridge. The bridge exposes Anthropic at /anthropic — every request is rewritten to api.anthropic.com on the other side. \`ANTHROPIC_AUTH_TOKEN\` is required by the CLI but the bridge strips the header, so any non-empty value works:
     export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
     export ANTHROPIC_AUTH_TOKEN=byoky
   Add both lines to my shell profile (~/.zshrc or ~/.bashrc) so new terminals pick them up.

5. Verify the bridge is up and Anthropic is in the provider list:
     curl http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[..., "anthropic", ...]}
   If anthropic is missing, the wallet doesn't have an Anthropic credential or gift — tell me to add one and stop.

6. Start Claude Code:
     claude

Troubleshooting cheatsheet (only mention if the relevant error shows up):
- "Third-party apps now draw from your extra usage" → the wallet is not treating this as first-party Claude Code. This is usually because the credential is an API key, not an OAuth setup token. Ask me to run \`claude setup-token\` and paste the result into the wallet.
- "ECONNREFUSED 127.0.0.1:19280" → the bridge proxy isn't running. Run \`byoky-bridge connect\` (or re-run it if the browser was restarted).
- "invalid x-api-key" or "Invalid bearer token" → the wallet credential is bad or expired. Swap it or use a gift.
- "rate_limit_error" on a gift → the gifter's upstream cap is being throttled. Try a different gift and wait a few minutes.
- Claude Code complains about missing model → override with \`--model claude-sonnet-4-5\` (or another model the gifter/wallet has access to).

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
