export interface GenerateResult {
  files: Record<string, string>;
  description: string;
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
- Use inline styles or CSS modules — no Tailwind unless requested`;

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

  messages.push({ role: 'user', content: prompt });

  const requestBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 12000,
    stream: true,
    system: SYSTEM_PROMPT,
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
