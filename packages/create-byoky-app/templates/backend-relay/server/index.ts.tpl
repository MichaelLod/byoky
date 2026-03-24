import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ByokyServer } from '@byoky/sdk/server';
import type { ByokyClient } from '@byoky/sdk/server';

const app = express();
app.use(express.json());

// CORS for local development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/relay' });
const byokyServer = new ByokyServer();

// Track connected clients
const clients = new Map<string, ByokyClient>();

wss.on('connection', async (ws: WebSocket) => {
  console.log('[relay] New WebSocket connection');

  try {
    const client = await byokyServer.handleConnection(ws);
    clients.set(client.sessionId, client);
    console.log(`[relay] Client connected: ${client.sessionId}`);

    const availableProviders = Object.entries(client.providers)
      .filter(([, p]) => p.available)
      .map(([id]) => id);
    console.log(`[relay] Available providers: ${availableProviders.join(', ') || 'none'}`);

    client.onClose(() => {
      clients.delete(client.sessionId);
      console.log(`[relay] Client disconnected: ${client.sessionId}`);
    });
  } catch (err) {
    console.error('[relay] Connection failed:', err instanceof Error ? err.message : err);
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    clients: clients.size,
  });
});

// Example: Make an LLM call through the relay
app.post('/api/generate', async (req, res) => {
  const { sessionId, prompt } = req.body as { sessionId?: string; prompt?: string };

  if (!sessionId || !prompt) {
    res.status(400).json({ error: 'Missing sessionId or prompt' });
    return;
  }

  const client = clients.get(sessionId);
  if (!client || !client.connected) {
    res.status(404).json({ error: 'Client not connected' });
    return;
  }

  // Find the first available provider
  const providerId = Object.entries(client.providers)
    .find(([, p]) => p.available)?.[0];

  if (!providerId) {
    res.status(400).json({ error: 'No providers available' });
    return;
  }

  try {
    const proxyFetch = client.createFetch(providerId);

    let url: string;
    let headers: Record<string, string>;
    let body: string;

    if (providerId === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': 'byoky',
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
    } else if (providerId === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer byoky',
      };
      body = JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      });
    } else {
      url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 256 },
      });
    }

    const response = await proxyFetch(url, { method: 'POST', headers, body });

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: text.slice(0, 500) });
      return;
    }

    const data = await response.json();

    let content: string;
    if (providerId === 'anthropic') {
      content = data.content?.[0]?.text ?? '';
    } else if (providerId === 'openai') {
      content = data.choices?.[0]?.message?.content ?? '';
    } else {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    res.json({ provider: providerId, content });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

const PORT = parseInt(process.env.PORT ?? '3001', 10);

server.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] WebSocket relay at ws://localhost:${PORT}/ws/relay`);
});
