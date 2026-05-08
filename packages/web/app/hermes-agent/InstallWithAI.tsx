'use client';

import { useState } from 'react';

const AI_PROMPT = `You are helping me set up Hermes Agent (Nous Research's self-improving CLI agent) to run on Byoky (https://byoky.com/hermes-agent).

Context:
- Byoky is a BYOK wallet extension. It holds API keys (mine, gifted, or a Claude Pro/Max subscription token) and proxies every LLM request so keys never leave the wallet.
- The Byoky bridge is a tiny local HTTP proxy on 127.0.0.1:19280. Hermes talks to the bridge, which forwards through native messaging to the extension, which calls the upstream provider (Anthropic in this guide).
- I already have the Byoky wallet installed (Chrome/Firefox) and an Anthropic credential or gift loaded. Do not worry about that side.
- IMPORTANT: Hermes's built-in \`anthropic\` provider goes direct to api.anthropic.com and ignores ANTHROPIC_BASE_URL. To route through byoky, you have to register the bridge as a custom_providers entry in ~/.hermes/config.yaml and switch model.provider to it. Env-vars alone do nothing.

Your job — run these commands on my machine and report each step:

1. Install Hermes Agent:
     curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --skip-setup
   This clones into ~/.hermes, creates a venv with uv, and registers the \`hermes\` command on PATH. Native Windows is not supported — use WSL2.
   Verify with \`hermes --version\`.

2. Install the Byoky bridge (v0.9.13+) and register the native messaging host:
     npm install -g @byoky/bridge
     byoky-bridge install
   Restart the browser afterwards so Chrome picks up the manifest.

3. Start the bridge proxy by connecting my wallet:
     byoky-bridge connect
   A browser tab opens on http://127.0.0.1:<ephemeral>, I click "Connect wallet", approve the session in the Byoky popup, and the CLI reports "Bridge listening on http://127.0.0.1:19280". After a browser restart, re-run \`byoky-bridge connect\`.

4. Verify the bridge is up and Anthropic is in the provider list:
     curl http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[..., "anthropic", ...]}
   If anthropic is missing, the wallet doesn't have an Anthropic credential or gift — tell me to add one and stop.

5. Wire Hermes to the bridge with the new helper command (it patches ~/.hermes/config.yaml idempotently and writes a .bak):
     byoky-bridge hermes-setup
   Expected output: "Patched ~/.hermes/config.yaml: model.provider: anthropic → byoky-anthropic ..." or "already routes through the bridge. Nothing to do."

   What it does (in case you're auditing): sets model.provider to byoky-anthropic, ensures model.default is a Claude model (claude-sonnet-4-6 by default; override with --model), and writes a custom_providers entry:
     - name: byoky-anthropic
       base_url: http://127.0.0.1:19280/anthropic
       api_key: ''
       api_mode: anthropic_messages   # NOT chat_completions — that 404s on the bridge

6. Smoke-test:
     hermes chat -q "ping" -Q
   On success: a one-line answer prints. On failure: see Troubleshooting below.

7. Confirm the routing actually went through byoky:
     hermes status | grep -E "Provider|Model"
   Expected output contains "Provider: custom" and the byoky-anthropic endpoint. If it shows "Provider: anthropic" or "Endpoint: api.anthropic.com", step 5 didn't take effect — re-check config.yaml.

8. To start an interactive session: \`hermes\` (no flag).

Troubleshooting cheatsheet (only mention if the relevant error shows up):
- HTTP 404 from http://127.0.0.1:19280/anthropic → The byoky-anthropic entry has api_mode: chat_completions. Change it to anthropic_messages.
- "hermes status" shows Endpoint: https://api.anthropic.com → Hermes is bypassing the bridge. The model.provider line is still "anthropic" instead of "byoky-anthropic", or the custom_providers entry name doesn't match. Re-check step 5(a) and (b).
- "Third-party apps now draw from your extra usage" → ONLY happens when Hermes hit api.anthropic.com directly. Verify with \`hermes status\`; if endpoint is api.anthropic.com, fix step 5. If the endpoint is :19280/anthropic and this still appears, the wallet credential needs swapping (fresh \`claude setup-token\` or a gift).
- "ECONNREFUSED 127.0.0.1:19280" → the bridge isn't running. Run \`byoky-bridge connect\`.
- "invalid x-api-key" or "Invalid bearer token" → the wallet credential is bad or expired. Swap it or use a gift.
- Migrating from OpenClaw → Hermes can import your settings, memories, skills, and API keys. Run \`hermes claw migrate\`. After it runs, you still need step 5 — flip the migrated byoky-anthropic api_mode from chat_completions to anthropic_messages.

Rules:
- Run one command at a time and show me the output before moving on.
- If a global npm install fails with EACCES, suggest a per-user npm prefix fix — do NOT auto-sudo.
- Do not edit any files in my repo. This is an install task, not a code change.
- If a step errors, stop and ask me — do not keep retrying.
- When you edit ~/.hermes/config.yaml, always make a .bak first and show me the diff before saving.
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
