export interface Template {
  id: string;
  name: string;
  description: string;
  tech: string;
  color: string;
  files: Record<string, string>;
}

export const TEMPLATES: Template[] = [
  {
    id: 'chat',
    name: 'AI Chat',
    description: 'Chat app with streaming. Anthropic Claude via Byoky.',
    tech: 'Next.js · React · Anthropic SDK',
    color: '#0ea5e9',
    files: {
      'package.json': `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@byoky/sdk": "^0.4.9",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}`,
      'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}`,
      'next.config.ts': `import type { NextConfig } from 'next';

const config: NextConfig = {};

export { config as default };`,
      'src/app/layout.tsx': `import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'AI chat powered by Byoky',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}`,
      'src/app/globals.css': `*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  height: 100%;
  background: #0a0a0a;
  color: #ededed;
  font-family: var(--font-inter), system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

#__next {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}`,
      'src/app/page.tsx': `'use client';

import { useState, useRef, useEffect } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import Anthropic from '@anthropic-ai/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Chat() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function connect() {
    const byoky = new Byoky();
    const s = await byoky.connect({
      providers: [{ id: 'anthropic', required: true }],
      modal: true,
    });
    setSession(s);
  }

  async function send() {
    if (!session || !input.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);

    const client = new Anthropic({
      apiKey: session.sessionKey,
      fetch: session.createFetch('anthropic'),
      dangerouslyAllowBrowser: true,
    });

    let assistantText = '';
    setMessages([...next, { role: 'assistant', content: '' }]);

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: next,
    });

    stream.on('text', (text) => {
      assistantText += text;
      setMessages([...next, { role: 'assistant', content: assistantText }]);
    });

    await stream.finalMessage();
    setLoading(false);
  }

  if (!session) {
    return (
      <div style={styles.center}>
        <h1 style={styles.title}>AI Chat</h1>
        <p style={styles.subtitle}>Connect your Byoky wallet to start chatting with Claude.</p>
        <button onClick={connect} style={styles.connectBtn}>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <strong style={{ color: m.role === 'user' ? '#0ea5e9' : '#86efac' }}>
              {m.role === 'user' ? 'You' : 'Claude'}
            </strong>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} style={styles.inputRow}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={styles.input}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()} style={styles.sendBtn}>
          {loading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16, padding: 24 },
  title: { fontSize: 32, fontWeight: 700 },
  subtitle: { color: '#888', maxWidth: 400, textAlign: 'center' },
  connectBtn: { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 32px', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  container: { display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 720, margin: '0 auto', width: '100%' },
  messages: { flex: 1, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 },
  userMsg: { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 },
  assistantMsg: { background: '#0a1a0a', border: '1px solid #1a2e1a', borderRadius: 12, padding: 16 },
  inputRow: { display: 'flex', gap: 8, padding: 16, borderTop: '1px solid #222' },
  input: { flex: 1, background: '#111', border: '1px solid #222', borderRadius: 8, padding: '12px 16px', color: '#ededed', fontSize: 14, outline: 'none' },
  sendBtn: { background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
};`,
      'README.md': `# {{PROJECT_NAME}}

AI chat app with streaming, powered by Byoky.

## Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) and click **Connect Wallet** to link your Byoky wallet.

## How it works

- Connects to the Byoky browser extension (or mobile app via QR)
- Uses the Anthropic SDK with \`session.createFetch('anthropic')\` for proxied API calls
- Your API key never leaves the wallet
`,
    },
  },
  {
    id: 'multi-provider',
    name: 'Multi-Provider',
    description: 'Connect multiple AI providers. Use whichever the user has.',
    tech: 'Vite · TypeScript',
    color: '#86efac',
    files: {
      'package.json': `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@byoky/sdk": "^0.4.9"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}`,
      'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}`,
      'vite.config.ts': `import { defineConfig } from 'vite';

export default defineConfig({});`,
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{PROJECT_NAME}}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`,
      'src/style.css': `*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0a0a0a;
  color: #ededed;
  font-family: system-ui, -apple-system, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#app {
  max-width: 600px;
  width: 100%;
  padding: 24px;
}

h1 {
  font-size: 28px;
  margin-bottom: 8px;
}

p {
  color: #888;
  margin-bottom: 24px;
}

button {
  background: #0ea5e9;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button:hover {
  opacity: 0.9;
}

.provider-card {
  background: #111;
  border: 1px solid #222;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.provider-name {
  font-weight: 600;
}

.provider-status {
  font-size: 13px;
  color: #888;
}

.provider-status.available {
  color: #86efac;
}

.test-btn {
  background: #222;
  padding: 8px 16px;
  font-size: 13px;
}

.result {
  background: #111;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 8px;
  font-size: 13px;
  color: #86efac;
  white-space: pre-wrap;
}`,
      'src/main.ts': `import { Byoky, type ByokySession } from '@byoky/sdk';
import './style.css';

const app = document.getElementById('app')!;
const PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;

function renderConnect() {
  app.innerHTML = \`
    <h1>Multi-Provider</h1>
    <p>Connect your Byoky wallet to see which AI providers are available.</p>
    <button id="connect">Connect Wallet</button>
  \`;
  document.getElementById('connect')!.addEventListener('click', connect);
}

async function connect() {
  const byoky = new Byoky();
  const session = await byoky.connect({
    providers: PROVIDERS.map((id) => ({ id })),
    modal: true,
  });
  renderProviders(session);
}

function renderProviders(session: ByokySession) {
  const cards = PROVIDERS.map((id) => {
    const info = session.providers[id];
    const available = info?.available ?? false;
    return \`
      <div class="provider-card">
        <div>
          <div class="provider-name">\${id}</div>
          <div class="provider-status \${available ? 'available' : ''}">\${available ? 'Connected' : 'Not configured'}</div>
        </div>
        \${available ? \`<button class="test-btn" data-provider="\${id}">Test</button>\` : ''}
      </div>
      <div id="result-\${id}"></div>
    \`;
  }).join('');

  app.innerHTML = \`<h1>Providers</h1><p>Click Test to make a sample API call.</p>\${cards}\`;

  app.querySelectorAll<HTMLButtonElement>('.test-btn').forEach((btn) => {
    btn.addEventListener('click', () => testProvider(session, btn.dataset.provider!));
  });
}

async function testProvider(session: ByokySession, providerId: string) {
  const el = document.getElementById(\`result-\${providerId}\`)!;
  el.innerHTML = '<div class="result">Calling API...</div>';
  try {
    const proxyFetch = session.createFetch(providerId);
    const url = providerId === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : providerId === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const body = providerId === 'anthropic'
      ? JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 64, messages: [{ role: 'user', content: 'Say hello in one sentence.' }] })
      : providerId === 'openai'
        ? JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 64, messages: [{ role: 'user', content: 'Say hello in one sentence.' }] })
        : JSON.stringify({ contents: [{ parts: [{ text: 'Say hello in one sentence.' }] }] });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (providerId === 'anthropic') headers['anthropic-version'] = '2023-06-01';
    const res = await proxyFetch(url, { method: 'POST', headers, body });
    const data = await res.json();
    el.innerHTML = \`<div class="result">\${JSON.stringify(data, null, 2)}</div>\`;
  } catch (err) {
    el.innerHTML = \`<div class="result" style="color:#f87171">\${err instanceof Error ? err.message : 'Unknown error'}</div>\`;
  }
}

renderConnect();`,
      'README.md': `# {{PROJECT_NAME}}

Multi-provider AI app powered by Byoky.

## Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:5173](http://localhost:5173) and click **Connect Wallet** to link your Byoky wallet.

## How it works

- Requests access to Anthropic, OpenAI, and Gemini (all optional)
- Shows which providers the user has configured
- Test button makes a sample API call through the wallet proxy
`,
    },
  },
  {
    id: 'backend-relay',
    name: 'Backend Relay',
    description: 'Server-side LLM calls through the user\'s wallet via WebSocket relay.',
    tech: 'Express · Node.js · Vite',
    color: '#f59e0b',
    files: {
      'package.json': `{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \\"tsx server/index.ts\\" \\"vite\\"",
    "build": "vite build && tsc server/index.ts --outDir dist/server"
  },
  "dependencies": {
    "@byoky/sdk": "^0.4.9",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "concurrently": "^9.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}`,
      'tsconfig.json': `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["server", "client"]
}`,
      'server/index.ts': `import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { ByokyServer, type ByokyClient } from '@byoky/sdk/server';

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/relay' });
const byoky = new ByokyServer();

let activeClient: ByokyClient | null = null;

wss.on('connection', async (ws) => {
  console.log('[relay] Client connected');
  try {
    activeClient = await byoky.handleConnection(ws);
    console.log('[relay] Wallet paired, providers:', Object.keys(activeClient.providers));
    activeClient.onClose(() => {
      console.log('[relay] Client disconnected');
      activeClient = null;
    });
  } catch (err) {
    console.error('[relay] Handshake failed:', err);
  }
});

app.post('/api/generate', async (req, res) => {
  if (!activeClient) {
    res.status(400).json({ error: 'No wallet connected. Connect from the frontend first.' });
    return;
  }
  const { prompt } = req.body;
  if (!prompt) {
    res.status(400).json({ error: 'Missing prompt field' });
    return;
  }
  try {
    const proxyFetch = activeClient.createFetch('anthropic');
    const apiRes = await proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await apiRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

const PORT = 3001;
server.listen(PORT, () => console.log(\`Server running on http://localhost:\${PORT}\`));`,
      'vite.config.ts': `import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
});`,
      'client/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{PROJECT_NAME}}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/main.ts"></script>
  </body>
</html>`,
      'client/style.css': `*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0a0a0a;
  color: #ededed;
  font-family: system-ui, -apple-system, sans-serif;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#app {
  max-width: 600px;
  width: 100%;
  padding: 24px;
}

h1 {
  font-size: 28px;
  margin-bottom: 8px;
}

p {
  color: #888;
  margin-bottom: 24px;
}

button {
  background: #f59e0b;
  color: #0a0a0a;
  border: none;
  border-radius: 8px;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

button:hover {
  opacity: 0.9;
}

.status {
  background: #111;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 13px;
}

.status.connected {
  border-color: #f59e0b;
  color: #f59e0b;
}

textarea {
  width: 100%;
  background: #111;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 12px 16px;
  color: #ededed;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
  min-height: 80px;
  margin-bottom: 12px;
  outline: none;
}

.result {
  background: #111;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 16px;
  margin-top: 16px;
  white-space: pre-wrap;
  font-size: 14px;
}`,
      'client/main.ts': `import { Byoky } from '@byoky/sdk';
import './style.css';

const app = document.getElementById('app')!;

function renderConnect() {
  app.innerHTML = \`
    <h1>Backend Relay</h1>
    <p>Connect your wallet, then the server makes LLM calls on your behalf.</p>
    <button id="connect">Connect Wallet</button>
  \`;
  document.getElementById('connect')!.addEventListener('click', connect);
}

async function connect() {
  const byoky = new Byoky();
  const session = await byoky.connect({
    providers: [{ id: 'anthropic', required: true }],
    modal: true,
  });

  app.innerHTML = \`
    <h1>Backend Relay</h1>
    <div class="status">Connecting relay...</div>
  \`;

  const relay = session.createRelay('ws://localhost:3001/ws/relay');
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (relay.status === 'connected') { clearInterval(check); resolve(); }
    }, 100);
  });

  renderPrompt();
}

function renderPrompt() {
  app.innerHTML = \`
    <h1>Backend Relay</h1>
    <div class="status connected">Wallet connected via relay</div>
    <textarea id="prompt" placeholder="Ask Claude something..."></textarea>
    <button id="generate">Generate</button>
    <div id="output"></div>
  \`;
  document.getElementById('generate')!.addEventListener('click', generate);
}

async function generate() {
  const prompt = (document.getElementById('prompt') as HTMLTextAreaElement).value.trim();
  const output = document.getElementById('output')!;
  if (!prompt) return;

  output.innerHTML = '<div class="result">Generating...</div>';
  try {
    const res = await fetch('http://localhost:3001/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text ?? JSON.stringify(data, null, 2);
    output.innerHTML = \`<div class="result">\${text}</div>\`;
  } catch (err) {
    output.innerHTML = \`<div class="result" style="color:#f87171">\${err instanceof Error ? err.message : 'Error'}</div>\`;
  }
}

renderConnect();`,
      'README.md': `# {{PROJECT_NAME}}

Backend relay demo — server-side LLM calls through the user's Byoky wallet.

## Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

This starts both the Express server (port 3001) and the Vite dev server (port 5173).

Open [http://localhost:5173](http://localhost:5173), connect your wallet, then type a prompt. The server makes the API call through the relay.

## How it works

1. Frontend connects to Byoky and opens a WebSocket relay to the backend
2. Backend receives the relay connection and stores the client
3. When you submit a prompt, the backend uses \`client.createFetch('anthropic')\` to call the API through the user's wallet
4. API keys never touch the server
`,
    },
  },
];
