export interface GenerateResult {
  files: Record<string, string>;
  description: string;
  miniappHtml: string | null;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are an expert web app generator for the Byoky platform. You generate complete, working applications that integrate @byoky/sdk for AI functionality.

## Output Format

First output a brief summary:
<description>One-sentence summary of what you built.</description>

Then output each file:
<file path="relative/path">
file content here
</file>

For iteration requests, only output changed files — not the entire project.

## Stack

- Next.js 15 (App Router) with TypeScript
- @byoky/sdk ^0.4.9 for AI integration (required — this is the whole point)
- Appropriate provider SDKs (@anthropic-ai/sdk, openai, etc.)
- Dark theme: background #0a0a0a, text #ededed
- Responsive, mobile-friendly layout

## Required Files (initial generation)

- package.json (with all dependencies)
- tsconfig.json
- next.config.ts
- src/app/layout.tsx (with metadata, Inter font, globals.css import)
- src/app/globals.css (dark theme, reset styles)
- src/app/page.tsx ('use client' — main app)
- README.md (setup instructions)

## @byoky/sdk API Reference

\`\`\`ts
import { Byoky, type ByokySession } from '@byoky/sdk';

// Connect to wallet
const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

// Proxied fetch (API key injected by extension)
const proxyFetch = session.createFetch('anthropic');

// With Anthropic SDK
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
  dangerouslyAllowBrowser: true,
});

// With OpenAI SDK
import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: session.sessionKey,
  fetch: session.createFetch('openai'),
  dangerouslyAllowBrowser: true,
});

// Other API
session.disconnect();
session.onDisconnect(cb);
session.providers; // Record of available providers
\`\`\`

## Quality Standards

- All code must be complete and working — no placeholders, no TODOs, no "implement this"
- Handle loading states, errors, and empty states
- Use proper TypeScript types (no \`any\`)
- No default exports except where Next.js requires them (page, layout)
- Include a "Connect Wallet" flow before the main UI
- Use inline styles or CSS modules — no Tailwind unless requested

## MiniApp Version

After all <file> tags, also output a **self-contained single HTML file** miniapp version wrapped in:
<miniapp>
...full HTML here...
</miniapp>

The miniapp HTML must:
- Be a complete standalone HTML file (inline CSS + inline JS, no external dependencies)
- Dark theme: background #0a0a0a, text #ededed, accent matching the app's purpose
- Include \`<meta name="miniapp" content='{"name":"APP_NAME","description":"SHORT_DESC","author":"byoky","providers":["PROVIDER_IDS"]}'>\`
- Include the Byoky MiniApp Runtime (a postMessage-based protocol for API calls):

\`\`\`
<script>
(function() {
  let sessionResolve;
  const sessionReady = new Promise(r => { sessionResolve = r; });
  let providers = {};
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'BYOKY_SESSION') { providers = e.data.providers || {}; sessionResolve(e.data); }
    if (e.data && e.data.type === 'BYOKY_API_RESPONSE') { const p = pending.get(e.data.requestId); if (p) { pending.delete(e.data.requestId); p.resolve(e.data); } }
    if (e.data && e.data.type === 'BYOKY_API_RESPONSE_START') { const p = pending.get(e.data.requestId); if (p && p.onStart) p.onStart(e.data); }
    if (e.data && e.data.type === 'BYOKY_API_RESPONSE_CHUNK') { const p = pending.get(e.data.requestId); if (p && p.onChunk) p.onChunk(e.data.chunk); }
    if (e.data && e.data.type === 'BYOKY_API_RESPONSE_END') { const p = pending.get(e.data.requestId); if (p) { pending.delete(e.data.requestId); if (p.onEnd) p.onEnd(); } }
    if (e.data && e.data.type === 'BYOKY_API_RESPONSE_ERROR') { const p = pending.get(e.data.requestId); if (p) { pending.delete(e.data.requestId); p.reject(new Error(e.data.error)); } }
  });
  window.parent.postMessage({ type: 'MINIAPP_READY' }, '*');
  let reqId = 0;
  const pending = new Map();
  window.byoky = {
    sessionReady,
    get providers() { return providers; },
    async fetch(provider, url, options) {
      await sessionReady; options = options || {};
      const id = String(++reqId);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: (d) => resolve(new Response(d.body, { status: d.status, headers: d.headers || {} })), reject });
        window.parent.postMessage({ type: 'BYOKY_API_REQUEST', requestId: id, provider, url, method: options.method || 'POST', headers: options.headers || {}, body: options.body || null }, '*');
      });
    },
    async fetchStream(provider, url, options) {
      await sessionReady; options = options || {};
      const id = String(++reqId);
      return new Promise((resolve, reject) => {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        pending.set(id, {
          onStart: (d) => resolve(new Response(readable, { status: d.status, headers: d.headers || {} })),
          onChunk: (chunk) => { writer.write(encoder.encode(chunk)).catch(() => {}); },
          onEnd: () => { writer.close().catch(() => {}); },
          reject: (err) => { writer.abort(err).catch(() => {}); reject(err); }
        });
        window.parent.postMessage({ type: 'BYOKY_API_REQUEST', requestId: id, provider, url, method: options.method || 'POST', headers: options.headers || {}, body: options.body || null, stream: true }, '*');
      });
    }
  };
})();
</script>
\`\`\`

- Use window.byoky.fetch(provider, url, options) for non-streaming API calls
- Use window.byoky.fetchStream(provider, url, options) for streaming API calls
- Parse SSE for Anthropic streaming: lines starting with "data: ", extract content_block_delta with text_delta
- Be responsive and mobile-friendly
- The miniapp runs inside an iframe on byoky.com — the parent page handles wallet connection and API proxying`;

export function parseGeneratedFiles(text: string): Record<string, string> {
  const files: Record<string, string> = {};
  const regex = /<file\s+path="([^"]+)">\n?([\s\S]*?)\n?<\/file>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const path = match[1].trim();
    const content = match[2];
    if (path && content !== undefined) {
      files[path] = content;
    }
  }
  return files;
}

export function parseDescription(text: string): string {
  const match = text.match(/<description>([\s\S]*?)<\/description>/);
  return match?.[1]?.trim() ?? 'Generated application';
}

export function parseMiniappHtml(text: string): string | null {
  const match = text.match(/<miniapp>\n?([\s\S]*?)\n?<\/miniapp>/);
  return match?.[1]?.trim() ?? null;
}

/**
 * Generate an app from a description. Uses Claude via the Byoky proxy.
 * Supports iteration — pass previous messages for context.
 */
export async function generateApp(
  proxyFetch: typeof fetch,
  prompt: string,
  previousMessages?: Message[],
): Promise<GenerateResult> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  if (previousMessages) {
    for (const msg of previousMessages) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  // Put generator instructions in the user message instead of the system field.
  // Setup tokens (OAuth) require the Claude Code system prompt in the system field —
  // the extension injects it automatically. Putting our own system prompt would conflict.
  const isFirstMessage = messages.length === 0;
  const userContent = isFirstMessage
    ? `${SYSTEM_PROMPT}\n\n---\n\nUser request: ${prompt}`
    : prompt;
  messages.push({ role: 'user', content: userContent });

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    stream: true,
    messages,
  };

  const res = await proxyFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API request failed (${res.status}): ${body}`);
  }

  const fullText = await collectStream(res);

  const files = parseGeneratedFiles(fullText);
  if (Object.keys(files).length === 0) {
    throw new Error(
      `No files found in response. Raw output:\n\n${fullText.slice(0, 2000)}`,
    );
  }

  return {
    files,
    description: parseDescription(fullText),
    miniappHtml: parseMiniappHtml(fullText),
  };
}

async function collectStream(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const json = await res.json();
    const text =
      json.content?.[0]?.text ??
      (typeof json === 'string' ? json : JSON.stringify(json));
    return text;
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          fullText += event.delta.text;
        }
      } catch {
        // skip malformed SSE chunks
      }
    }
  }

  return fullText;
}
