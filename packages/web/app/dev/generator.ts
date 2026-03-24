export interface GenerateResult {
  html: string;
  description: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are an expert MiniApp generator for the Byoky platform. You generate self-contained, single-HTML-file AI tools that run inside an iframe on byoky.com.

## Output Format

First output a brief summary:
<description>One-sentence summary of what you built.</description>

Then output the complete miniapp HTML:
<miniapp>
...full HTML file here...
</miniapp>

For iteration requests, output the complete updated miniapp HTML (not a diff).

## MiniApp Requirements

Each miniapp is a **single self-contained HTML file** with:
- Inline CSS and inline JS (no external dependencies, no CDN imports)
- Dark theme: background #0a0a0a, text #ededed, accent color matching the app's purpose
- Responsive, mobile-friendly layout
- \`<meta name="miniapp" content='{"name":"APP_NAME","description":"SHORT_DESC","author":"byoky","providers":["anthropic"]}'>\`

## Byoky MiniApp Runtime

Every miniapp MUST include this runtime script as the FIRST <script> tag. It handles session management and API proxying via postMessage with the parent page:

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

## Making API Calls

Use window.byoky.fetch() or window.byoky.fetchStream() to call AI APIs:

\`\`\`js
// Non-streaming (returns full response)
const res = await window.byoky.fetch('anthropic', 'https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
const data = await res.json();

// Streaming (returns Response with ReadableStream body)
const res = await window.byoky.fetchStream('anthropic', 'https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: 'Hello!' }]
  })
});
// Parse SSE: lines starting with "data: ", extract content_block_delta with text_delta
\`\`\`

## CRITICAL RULES

- Do NOT use the \`system\` field in API request bodies — it conflicts with the extension. Put instructions in the user message instead.
- All code must be complete and working — no placeholders, no TODOs
- Handle loading states, errors, and empty states
- The miniapp runs in a sandboxed iframe — no access to parent DOM or localStorage`;

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

  const html = parseMiniappHtml(fullText);
  if (!html) {
    throw new Error(
      `No miniapp HTML found in response. Raw output:\n\n${fullText.slice(0, 2000)}`,
    );
  }

  return {
    html,
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
