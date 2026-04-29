'use client';

import { useState } from 'react';

const AI_PROMPT = `You are helping me set up Hermes Agent (Nous Research's self-improving CLI agent) to run on Byoky (https://byoky.com/hermes-agent).

Context:
- Byoky is a BYOK wallet extension. It holds API keys (mine, gifted, or a Claude Pro/Max subscription token) and proxies every LLM request so keys never leave the wallet.
- The Byoky bridge is a tiny local HTTP proxy on 127.0.0.1:19280. Hermes talks to the bridge, which forwards through native messaging to the extension, which calls the upstream provider (Anthropic in this guide).
- I already have the Byoky wallet installed (Chrome/Firefox) and an Anthropic credential or gift loaded. Do not worry about that side.
- Hermes auto-discovers Claude Code's stored OAuth token from ~/.claude/.credentials.json. Byoky strips the incoming x-api-key at the bridge boundary and injects the wallet credential instead, so this is safe — but if the user wonders why their explicit ANTHROPIC_API_KEY appears ignored, that's why.

Your job — run these commands on my machine and report each step:

1. Install Hermes Agent:
     curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup
   This clones into ~/.hermes, creates a venv with uv, and registers the \`hermes\` command on PATH. Native Windows is not supported — use WSL2.
   Verify with \`hermes --version\`.

2. Install the Byoky bridge (v0.9.3+) and register the native messaging host:
     npm install -g @byoky/bridge
     byoky-bridge install
   Restart the browser afterwards so Chrome picks up the manifest.

3. Start the bridge proxy by connecting my wallet:
     byoky-bridge connect
   A browser tab opens on http://127.0.0.1:<ephemeral>, I click "Connect wallet", approve the session in the Byoky popup, and the CLI reports "Bridge listening on http://127.0.0.1:19280". After a browser restart, re-run \`byoky-bridge connect\`.

4. Point Hermes at the local Byoky bridge:
     export ANTHROPIC_BASE_URL=http://127.0.0.1:19280/anthropic
     export ANTHROPIC_API_KEY=byoky
   Add both lines to ~/.zshrc or ~/.bashrc. The value of ANTHROPIC_API_KEY does not matter; the bridge strips the auth header and injects the wallet credential.

5. Verify the bridge is up and Anthropic is in the provider list:
     curl http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[..., "anthropic", ...]}
   If anthropic is missing, the wallet doesn't have an Anthropic credential or gift — tell me to add one and stop.

6. Tell Hermes to use Anthropic by default and start it:
     hermes model         # pick provider=anthropic + a Claude model
     hermes               # start chatting

Troubleshooting cheatsheet (only mention if the relevant error shows up):
- "Third-party apps now draw from your extra usage" → the wallet credential isn't being treated as first-party Claude Code. Run \`claude setup-token\` and paste the result into the wallet as a fresh Anthropic credential.
- "ECONNREFUSED 127.0.0.1:19280" → the bridge isn't running. Run \`byoky-bridge connect\`.
- Hermes complains about missing API key but ANTHROPIC_API_KEY is set → Hermes auto-discovers Claude Code's OAuth token from ~/.claude/.credentials.json and may prefer it. This is fine because the bridge strips and replaces the header anyway. If Hermes refuses to start, set the env var explicitly via \`hermes config set ANTHROPIC_API_KEY byoky\`.
- "invalid x-api-key" or "Invalid bearer token" → the wallet credential is bad or expired. Swap it or use a gift.
- Migrating from OpenClaw → Hermes can import your settings, memories, skills, and API keys. Run \`hermes claw migrate\`. Byoky still proxies the credential the same way.

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
