'use client';

import { useState } from 'react';

const AI_PROMPT = `You are helping me set up OpenClaw to run on Byoky (https://byoky.com/openclaw).

Context:
- Byoky is a BYOK wallet extension. It holds API keys (mine, gifted, or a Claude Pro/Max subscription token) and proxies every LLM request so keys never leave the wallet.
- The Byoky bridge is a tiny local HTTP proxy on 127.0.0.1:19280. OpenClaw talks to the bridge, which forwards through native messaging to the extension, which calls the provider.
- I already have the Byoky wallet installed (Chrome/Firefox/iOS/Android) and a credential or gift loaded. Do not worry about that side.

Your job — run these commands on my machine and report each step:

1. Install the OpenClaw plugin. OpenClaw loads plugins from ~/.openclaw/extensions (not the global npm prefix), so use OpenClaw's own installer — it declares @byoky/bridge as a dependency, so both are pulled in one step:
     openclaw plugins install @byoky/openclaw-plugin

2. Authenticate OpenClaw against Byoky. The default \`byoky\` meta-provider connects every provider I already have in the wallet (Anthropic, OpenAI, Gemini, etc.) in one shot:
     openclaw models auth login --provider byoky
   On first run, OpenClaw will ask to register the native messaging host — accept (press Enter). Then it opens my browser so the wallet can approve the connection. Wait for me to confirm I approved it.
   If I'd rather connect only one specific provider, substitute e.g. \`--provider byoky-anthropic\` (other ids: byoky-openai, byoky-gemini, byoky-xai, byoky-deepseek, byoky-mistral, byoky-groq, byoky-cohere, byoky-perplexity, byoky-together, byoky-fireworks, byoky-openrouter, byoky-azure_openai).

3. Set the OpenClaw agent's default model to a byoky one. The onboarding wizard picks \`openai/gpt-5.4\` (the direct \`openai\` plugin, which has no key) — that causes "No API key found for provider openai" errors on every run. Ask me which provider I want as the default, then run:
     openclaw models set byoky-anthropic/claude-sonnet-4-6
   (or byoky-openai/gpt-4.1, byoky-gemini/gemini-2.5-pro — \`openclaw models list --all\` shows every option.)

4. Verify the bridge is up and lists the connected providers:
     curl http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[...]}

5. Inside OpenClaw I can run /byoky anytime to see bridge status and connected providers.

Troubleshooting cheatsheet (only mention if the relevant error shows up):
- "invalid x-api-key" or "Invalid bearer token" → the key in the wallet is bad/expired. Ask me to swap it or use a gift.
- "rate_limit_error" on Anthropic → usually the gifter's upstream cap; try a different gift or switch providers.
- "provider not available in this session" after I added a wallet key → re-run \`openclaw models auth login --provider byoky\`.
- OpenClaw keeps failing even after I fixed a credential → \`openclaw gateway restart\` clears the in-memory profile cooldown.
- Higher-tier Anthropic key? Plugin defaults max_tokens to 4096 for gift compatibility. Override via \`plugins.entries.byoky.config.anthropicMaxTokens\` in ~/.openclaw/openclaw.json (then re-auth).

Rules:
- Run one command at a time and show me the output before moving on.
- If the plugin install fails with EACCES, suggest a per-user npm prefix fix — do NOT auto-sudo.
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
