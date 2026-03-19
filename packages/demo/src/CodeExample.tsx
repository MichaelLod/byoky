import { useState } from 'react';

const examples = [
  {
    id: 'native-sdk',
    label: 'Native SDK',
    filename: 'native-sdk.ts',
    description:
      'Use any provider SDK as-is. Just swap in createFetch — full API compatibility, including streaming.',
    code: `import Anthropic from '@anthropic-ai/sdk';
import { Byoky } from '@byoky/sdk';

const byoky = new Byoky();
const session = await byoky.connect({
  providers: [{ id: 'anthropic', required: true }],
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const message = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
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
});

const client = new OpenAI({
  apiKey: session.sessionKey,
  fetch: session.createFetch('openai'),
});

const extraction = await client.chat.completions.create({
  model: 'gpt-4o',
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
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
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
});

const client = new Anthropic({
  apiKey: session.sessionKey,
  fetch: session.createFetch('anthropic'),
});

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
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
        model: 'claude-sonnet-4-20250514',
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
        model: 'gpt-4o',
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
          <code>{active.code}</code>
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
