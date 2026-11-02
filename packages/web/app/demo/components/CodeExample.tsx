import { useState } from 'react';
import { highlightCode } from '../../components/highlight';

const examples = [
  {
    id: 'native-sdk',
    label: 'Native SDK',
    filename: 'native-sdk.ts',
    description:
      'Use any provider SDK as-is. Just swap in createFetch — inference API compatibility, including streaming.',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true, // built-in connect UI, with install guidance if no wallet is found
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
  dangerouslyAllowBrowser: true, // apiKey is a session token, not a key
});

const message = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});`,
  },
  {
    id: 'structured-output',
    label: 'Structured Output',
    filename: 'structured-output.ts',
    description:
      'Extract typed data from unstructured text. JSON schemas, tool use, and function calling all work through the proxy.',
    code: `import OpenAI from 'openai';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'openai', required: true }],
  modal: true,
});

const client = new OpenAI({
  apiKey: session.sessionKey,
  fetch: session.createFetch('openai'),
  dangerouslyAllowBrowser: true, // apiKey is a session token, not a key
});

const extraction = await client.chat.completions.create({
  model: 'gpt-5.5',
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'contact',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          company: { type: 'string' },
        },
        required: ['name', 'email'],
      },
    },
  },
  messages: [{
    role: 'user',
    content: 'Extract: "Reach me at jane@acme.co — Jane, Acme Inc"',
  }],
});

const contact = JSON.parse(extraction.choices[0].message.content);
// { name: "Jane", email: "jane@acme.co", company: "Acme Inc" }`,
  },
  {
    id: 'streaming',
    label: 'Streaming',
    filename: 'streaming.ts',
    description:
      'Stream responses token-by-token. The proxy forwards chunks over a persistent port — no polling, no buffering.',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
  dangerouslyAllowBrowser: true, // apiKey is a session token, not a key
});

const stream = client.messages.stream({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Write a haiku about security.' }],
});

for await (const event of stream) {
  if (event.type === 'content_block_delta'
    && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}`,
  },
  {
    id: 'tool-use',
    label: 'Tool Use',
    filename: 'tool-use.ts',
    description:
      'Define tools and let the model call them. Function calling works identically through the proxy.',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
  dangerouslyAllowBrowser: true, // apiKey is a session token, not a key
});

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  tools: [{
    name: 'get_weather',
    description: 'Get current weather for a city',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
        units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['city'],
    },
  }],
  messages: [{
    role: 'user',
    content: 'What\\'s the weather in Tokyo?',
  }],
});

// Claude calls get_weather({ city: "Tokyo" })
// Handle the tool_use block, run your function, send results back`,
  },
  {
    id: 'vision',
    label: 'Vision',
    filename: 'vision.ts',
    description:
      'Analyze images with Claude or GPT. The image goes inline through the proxy — your app never sees the key.',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true,
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
  dangerouslyAllowBrowser: true, // apiKey is a session token, not a key
});

// Read a file from an <input> or drag-and-drop
const file: File = document.querySelector('input')!.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());
let binary = '';
// One byte at a time: spreading a whole photo into fromCharCode
// overflows the call stack.
for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
const base64 = btoa(binary);

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  messages: [{
    role: 'user',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: file.type as 'image/jpeg',
          data: base64,
        },
      },
      { type: 'text', text: 'What is in this image?' },
    ],
  }],
});`,
  },
  {
    id: 'backend-relay',
    label: 'Backend Relay',
    filename: 'relay.ts',
    description:
      'Let your backend make LLM calls through the user\'s browser. Keys never leave the extension — even from the server.',
    code: `// === Frontend (browser) ===
import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [{ id: 'anthropic', required: true }],
  modal: true, // built-in connect UI
});

// Open relay — backend can now make LLM calls through this session
const relay = session.createRelay('wss://your-app.com/ws/relay');

// === Backend (Node.js) ===
import { ByokyServer } from '@byoky/sdk/server';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 3001 });
const byoky = new ByokyServer();

wss.on('connection', async (ws) => {
  try {
    const client = await byoky.handleConnection(ws);
    console.log('Providers:', Object.keys(client.providers));

    // Make LLM calls as if you had the API key
    const fetch = client.createFetch('anthropic');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'Hello!' }],
      }),
    });
    const data = await res.json();
  } catch (err) {
    // Rejects when the browser never says hello or the tab closes
    // mid-request. Uncaught, it would end the Node process.
    console.error('[relay]', err);
  }
});`,
  },
  {
    id: 'multi-provider',
    label: 'Multi-Provider',
    filename: 'multi-provider.ts',
    description:
      'Request multiple providers in a single session. Let users choose which model to use — or fan out to all of them.',
    code: `import { Byoky } from '@byoky/sdk';

const session = await new Byoky().connect({
  providers: [
    { id: 'anthropic', required: false },
    { id: 'openai', required: false },
    { id: 'gemini', required: false },
  ],
  modal: true,
});

// Check which providers the user approved
const available = Object.entries(session.providers)
  .filter(([, v]) => v.available)
  .map(([id]) => id);

// Use whichever is available
async function ask(provider: string, prompt: string) {
  const fetch = session.createFetch(provider);

  if (provider === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  }

  if (provider === 'openai') {
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  }
}

// Fan out to all available providers
const results = await Promise.all(
  available.map((p) => ask(p, 'Summarize this doc...')),
);`,
  },
  {
    id: 'bridge-proxy',
    label: 'Bridge Proxy',
    filename: 'bridge-proxy.sh',
    description:
      'CLI and desktop apps route API calls through the local Byoky Bridge. API keys never leave the extension; a Claude setup token goes to the local bridge, which makes that call from Node.',
    code: `# Install the bridge
npm install -g @byoky/bridge
byoky-bridge install   # registers the bridge; doesn't start the proxy
byoky-bridge connect   # approve a session; the extension starts the proxy on 127.0.0.1:19280

# More than one provider:
#   byoky-bridge connect --providers anthropic,openai
#
# Run connect again after a browser restart, a wallet lock or the
# 24 h session expiry. ECONNREFUSED 127.0.0.1:19280 means the proxy
# isn't running.
#
# CLI tools send requests to the bridge instead of the real API:
#
#   POST http://127.0.0.1:19280/anthropic/v1/messages
#
# The bridge relays to the extension via native messaging.
# The extension injects the real key and calls the actual API.
# The response flows back through the same chain.
#
# API keys never leave the browser extension. (A Claude setup token
# is handed to the local bridge, which calls Anthropic from Node.)
#
# Every request carries the bridge token as its API key.
# Example with curl:
curl http://127.0.0.1:19280/anthropic/v1/messages \\
  -H "x-api-key: $(byoky-bridge token)" \\
  -H "content-type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
  },
];

export function CodeExample() {
  const [activeTab, setActiveTab] = useState(examples[0].id);
  const active = examples.find((e) => e.id === activeTab) ?? examples[0];

  return (
    <div className="code-example">
      <h2>What you can build</h2>
      <p className="code-desc">
        Every example below works through the Byoky proxy — your app never
        touches an API key.
      </p>

      <div className="code-tabs">
        {examples.map((ex) => (
          <button
            key={ex.id}
            className={`code-tab ${activeTab === ex.id ? 'code-tab-active' : ''}`}
            onClick={() => setActiveTab(ex.id)}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <p className="code-tab-desc">{active.description}</p>

      <div className="code-window">
        <div className="code-titlebar">
          <span className="code-dot red" />
          <span className="code-dot yellow" />
          <span className="code-dot green" />
          <span className="code-filename">{active.filename}</span>
        </div>
        <pre className="code-body">
          <code>{highlightCode(active.code)}</code>
        </pre>
      </div>

      <div className="code-links">
        <a
          href="https://github.com/MichaelLod/byoky"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
        >
          View source on GitHub
        </a>
        <a
          href="https://www.npmjs.com/package/@byoky/sdk"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost"
        >
          npm install @byoky/sdk
        </a>
      </div>
    </div>
  );
}
