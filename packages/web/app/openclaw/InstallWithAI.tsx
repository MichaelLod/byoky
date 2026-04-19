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

3. Verify the bridge is up and lists the connected providers:
     curl http://127.0.0.1:19280/health
   Expected: {"status":"ok","providers":[...]}

4. Inside OpenClaw I can run /byoky anytime to see bridge status and connected providers.

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
    <div className="oc-ai-cta">
      <div className="oc-ai-cta-text">
        <div className="oc-ai-cta-title">
          <span className="oc-ai-cta-spark" aria-hidden>✦</span>
          Install with AI
        </div>
        <div className="oc-ai-cta-subtitle">
          Copy a ready-made prompt, paste it into Claude Code, Codex, Cursor,
          or OpenClaw itself, and let the assistant run the bridge + plugin
          install for you.
        </div>
      </div>
      <button
        type="button"
        className={`oc-ai-cta-btn ${copied ? 'copied' : ''}`}
        onClick={copy}
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Copy install prompt
          </>
        )}
      </button>
    </div>
  );
}
