import { useState, useRef } from 'react';
import type { ByokySession } from '@byoky/sdk';
import { ByokyServer } from '@byoky/sdk/server';
import { createMockWebSocketPair } from './mock-ws';

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Google Gemini',
  mistral: 'Mistral', cohere: 'Cohere', xai: 'xAI (Grok)',
  deepseek: 'DeepSeek', groq: 'Groq', perplexity: 'Perplexity',
};

interface LogEntry {
  id: number;
  from: 'client' | 'server';
  type: string;
  preview: string;
  ts: number;
}

interface Props {
  session: ByokySession;
}

export function BackendRelay({ session }: Props) {
  const [prompt, setPrompt] = useState('Explain the backend relay pattern in one sentence.');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [response, setResponse] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const counter = useRef(0);

  const availableProviders = Object.entries(session.providers)
    .filter(([, v]) => v.available)
    .map(([id]) => id);

  async function run() {
    setRunning(true);
    setLog([]);
    setResponse('');
    setError('');
    counter.current = 0;

    try {
      const byokyServer = new ByokyServer({ pingInterval: 0, helloTimeout: 5000 });

      // Create a mock WebSocket pair with message logging
      const pair = createMockWebSocketPair((from, data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'relay:ping' || msg.type === 'relay:pong') return;
          const preview = getPreview(msg);
          setLog((prev) => [...prev, {
            id: ++counter.current,
            from,
            type: msg.type,
            preview,
            ts: Date.now(),
          }]);
        } catch { /* ignore non-JSON */ }
      });

      // Server side: wait for connection
      const clientPromise = byokyServer.handleConnection(pair.server);

      // Client side: send hello and handle relay requests
      const clientWs = pair.client;

      // Wait for WS to open, then send hello
      await new Promise<void>((resolve) => {
        if (clientWs.readyState === 1) {
          resolve();
        } else {
          clientWs.onopen = () => resolve();
        }
      });

      clientWs.send(JSON.stringify({
        type: 'relay:hello',
        sessionId: session.sessionKey,
        providers: session.providers,
      }));

      // Handle relay requests from the server
      clientWs.onmessage = async (event: { data: unknown }) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type !== 'relay:request') return;

        const { requestId, providerId, url, method, headers, body } = msg;
        try {
          const proxyFetch = session.createFetch(providerId);
          const res = await proxyFetch(url, { method, headers, body });

          const resHeaders: Record<string, string> = {};
          res.headers.forEach((v: string, k: string) => { resHeaders[k] = v; });

          clientWs.send(JSON.stringify({
            type: 'relay:response:meta',
            requestId,
            status: res.status,
            statusText: res.statusText,
            headers: resHeaders,
          }));

          if (res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              clientWs.send(JSON.stringify({
                type: 'relay:response:chunk',
                requestId,
                chunk: decoder.decode(value, { stream: true }),
              }));
            }
          }

          clientWs.send(JSON.stringify({
            type: 'relay:response:done',
            requestId,
          }));
        } catch (err) {
          clientWs.send(JSON.stringify({
            type: 'relay:response:error',
            requestId,
            error: { code: 'PROXY_ERROR', message: (err as Error).message },
          }));
        }
      };

      // Wait for ByokyServer to get the hello
      const client = await clientPromise;

      // Now make an LLM call from the "backend"
      const fetchFn = client.createFetch(provider);

      const apiUrl = provider === 'anthropic'
        ? 'https://api.anthropic.com/v1/messages'
        : provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : provider === 'gemini'
        ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
        : `https://api.${provider}.com/v1/chat/completions`;

      const reqBody = provider === 'anthropic'
        ? {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 512,
            messages: [{ role: 'user', content: prompt }],
          }
        : provider === 'gemini'
        ? {
            contents: [{ parts: [{ text: prompt }] }],
          }
        : {
            model: provider === 'openai' ? 'gpt-4o-mini' : undefined,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 512,
          };

      const reqHeaders: Record<string, string> = {
        'content-type': 'application/json',
      };
      if (provider === 'anthropic') {
        reqHeaders['anthropic-version'] = '2023-06-01';
      }

      const res = await fetchFn(apiUrl, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(reqBody),
      });

      const text = await res.text();

      // Extract the response text
      try {
        const parsed = JSON.parse(text);
        if (provider === 'anthropic') {
          setResponse(parsed.content?.[0]?.text ?? text);
        } else if (provider === 'gemini') {
          setResponse(parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? text);
        } else {
          setResponse(parsed.choices?.[0]?.message?.content ?? text);
        }
      } catch {
        setResponse(text);
      }

      client.close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="demo-panel">
      <div className="demo-header">
        <h3>Backend Relay</h3>
        <select
          className="demo-provider-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          {availableProviders.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_NAMES[id] ?? id}
            </option>
          ))}
        </select>
      </div>

      <p className="demo-desc">
        Simulates a backend server making LLM calls through your browser.
        The request flows: <code>Backend</code> → <code>WebSocket</code> → <code>Browser</code> → <code>Extension</code> → <code>LLM API</code>. Your API key never leaves the extension.
      </p>

      <textarea
        className="demo-textarea"
        rows={2}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Enter a prompt..."
      />

      <button
        className="btn btn-primary"
        onClick={run}
        disabled={running || !prompt.trim()}
      >
        {running ? 'Running relay...' : 'Run Backend Call'}
      </button>

      {error && <div className="demo-error">{error}</div>}

      {log.length > 0 && (
        <div className="relay-log">
          <div className="relay-log-header">Protocol Messages</div>
          {log.map((entry) => (
            <div key={entry.id} className={`relay-step relay-step-${entry.from}`}>
              <span className="relay-arrow">
                {entry.from === 'client' ? '→' : '←'}
              </span>
              <span className="relay-from">
                {entry.from === 'client' ? 'Frontend' : 'Backend'}
              </span>
              <span className={`relay-type relay-type-${entry.type.split(':').pop()}`}>
                {entry.type.replace('relay:', '')}
              </span>
              <span className="relay-preview">{entry.preview}</span>
            </div>
          ))}
        </div>
      )}

      {response && (
        <div className="demo-result">
          <pre>{response}</pre>
        </div>
      )}
    </div>
  );
}

function getPreview(msg: Record<string, unknown>): string {
  switch (msg.type) {
    case 'relay:hello':
      return `providers: ${Object.keys(msg.providers as object).join(', ')}`;
    case 'relay:request':
      return `${msg.method} ${(msg.url as string).split('/').slice(-2).join('/')}`;
    case 'relay:response:meta':
      return `${msg.status} ${msg.statusText}`;
    case 'relay:response:chunk': {
      const chunk = msg.chunk as string;
      return chunk.length > 60 ? chunk.slice(0, 60) + '…' : chunk;
    }
    case 'relay:response:done':
      return 'stream complete';
    case 'relay:response:error':
      return (msg.error as { message: string }).message;
    default:
      return '';
  }
}
