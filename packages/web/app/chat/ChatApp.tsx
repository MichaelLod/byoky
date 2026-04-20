'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  image?: { base64: string; mediaType: string; name: string };
  streaming?: boolean;
  provider?: string;
}

const providers: Record<string, { url: string; models: string[]; name: string }> = {
  anthropic:  { url: 'https://api.anthropic.com/v1/messages',                 models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],                                                                                               name: 'Claude' },
  openai:     { url: 'https://api.openai.com/v1/chat/completions',            models: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-nano', 'gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'],                                                                       name: 'OpenAI' },
  gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/models', models: ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'],    name: 'Gemini' },
  groq:       { url: 'https://api.groq.com/openai/v1/chat/completions',       models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.1-8b-instant'],                                                        name: 'Groq' },
  deepseek:   { url: 'https://api.deepseek.com/chat/completions',             models: ['deepseek-chat', 'deepseek-reasoner'],                                                                                                                  name: 'DeepSeek' },
  xai:        { url: 'https://api.x.ai/v1/chat/completions',                  models: ['grok-4-fast-non-reasoning', 'grok-4-fast-reasoning', 'grok-4', 'grok-3-mini'],                                                                         name: 'Grok' },
  mistral:    { url: 'https://api.mistral.ai/v1/chat/completions',            models: ['mistral-large-latest', 'mistral-small-latest'],                                                                                                        name: 'Mistral' },
  together:   { url: 'https://api.together.xyz/v1/chat/completions',          models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],                     name: 'Together AI' },
  fireworks:  { url: 'https://api.fireworks.ai/inference/v1/chat/completions', models: ['accounts/fireworks/models/llama4-maverick-instruct-basic', 'accounts/fireworks/models/llama-v3p3-70b-instruct'],                                     name: 'Fireworks' },
  perplexity: { url: 'https://api.perplexity.ai/chat/completions',            models: ['sonar', 'sonar-pro', 'sonar-deep-research'],                                                                                                           name: 'Perplexity' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',         models: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4-mini', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],                                  name: 'OpenRouter' },
  cohere:     { url: 'https://api.cohere.com/v2/chat',                        models: ['command-a-03-2025', 'command-r-plus', 'command-r7b-12-2024'],                                                                                         name: 'Cohere' },
};

const visionProviders = new Set(['anthropic', 'openai', 'gemini']);
const providerIds = Object.keys(providers);

const suggestedPrompts = [
  'Which model are you?',
  'Explain how API keys work in 3 sentences',
  'Write a TypeScript function that reverses a string',
  'What are the main differences between REST and GraphQL?',
  'Create a haiku about open-source software',
];

async function* parseSSE(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try { yield JSON.parse(data); } catch {}
      }
    }
  }
}

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*(?!\*)[^*]+\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="md-inline-code">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  if (!text) return <span />;
  const blocks: React.ReactNode[] = [];
  const segments = text.split(/(```[\s\S]*?```)/g);
  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si];
    if (segment.startsWith('```')) {
      const match = segment.match(/```(\w*)\n?([\s\S]*?)```/);
      if (match) blocks.push(<pre key={si} className="md-code-block">{match[1] && <span className="md-code-lang">{match[1]}</span>}<code>{match[2].trimEnd()}</code></pre>);
      continue;
    }
    const paragraphs = segment.split(/\n\n+/);
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi].trim();
      if (!para) continue;
      const key = `${si}-${pi}`;
      const lines = para.split('\n');
      if (lines.every(l => !l.trim() || /^[-*]\s/.test(l.trim()))) {
        blocks.push(<ul key={key} className="md-list">{lines.filter(l => l.trim()).map((l, i) => <li key={i}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>)}</ul>);
      } else if (lines.every(l => !l.trim() || /^\d+\.\s/.test(l.trim()))) {
        blocks.push(<ol key={key} className="md-list">{lines.filter(l => l.trim()).map((l, i) => <li key={i}>{renderInline(l.replace(/^\d+\.\s+/, ''))}</li>)}</ol>);
      } else if (para.startsWith('### ')) {
        blocks.push(<h4 key={key} className="md-heading">{renderInline(para.slice(4))}</h4>);
      } else if (para.startsWith('## ')) {
        blocks.push(<h3 key={key} className="md-heading">{renderInline(para.slice(3))}</h3>);
      } else if (para.startsWith('# ')) {
        blocks.push(<h2 key={key} className="md-heading">{renderInline(para.slice(2))}</h2>);
      } else {
        blocks.push(<p key={key}>{lines.map((line, i) => <Fragment key={i}>{i > 0 && <br />}{renderInline(line)}</Fragment>)}</p>);
      }
    }
  }
  return <>{blocks}</>;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const byoky = new Byoky({ timeout: 120_000 });

export function ChatApp() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await byoky.tryReconnect();
        if (s) { onConnected(s); return; }
      } catch {}
      // Auto-connect when loaded inside the Byoky extension popup (trusted
      // installed apps auto-approve; non-trusted sites will fall through to
      // the manual Connect button).
      const inPopup = typeof window !== 'undefined' && window.location.hash.includes('byoky-in-popup');
      if (!inPopup) return;
      try {
        const s = await byoky.connect({
          providers: providerIds.map(id => ({ id, required: false })),
        });
        onConnected(s);
      } catch {}
    })();
  }, []);

  function onConnected(s: ByokySession) {
    s.onDisconnect(() => setSession(null));
    s.onProvidersUpdated((p) => setSession(prev => prev ? { ...prev, providers: p } : null));
    setSession(s);
  }

  async function handleConnect() {
    setError(null);
    try {
      const s = await byoky.connect({
        providers: providerIds.map(id => ({ id, required: false })),
        modal: true,
      });
      onConnected(s);
    } catch (e) {
      const err = e as Error;
      if (err.message === 'User cancelled') return;
      setError(err.message);
    }
  }

  return (
    <div className="chat-app">
      {session ? (
        <ChatView session={session} onDisconnect={() => { session.disconnect(); setSession(null); }} />
      ) : (
        <ConnectScreen onConnect={handleConnect} error={error} />
      )}
    </div>
  );
}

function ConnectScreen({ onConnect, error }: { onConnect: () => void; error: string | null }) {
  return (
    <div className="connect">
      <div className="connect-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h1>Byoky Chat</h1>
      <p>Multi-provider AI chat powered by your own API keys. Connect your Byoky wallet to start chatting.</p>
      <button className="connect-btn" onClick={onConnect}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
          <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
          <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
        </svg>
        Connect Wallet
      </button>
      {error && <div className="connect-error">{error}</div>}
      <div className="connect-features">
        <div className="connect-feature"><span className="check">&#10003;</span> Keys stay encrypted in your wallet</div>
        <div className="connect-feature"><span className="check">&#10003;</span> This app never sees your API keys</div>
        <div className="connect-feature"><span className="check">&#10003;</span> Switch providers mid-conversation</div>
      </div>
    </div>
  );
}

function ChatView({ session, onDisconnect }: { session: ByokySession; onDisconnect: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('byoky-chat-models') || '{}'); } catch { return {}; }
  });
  const [attachedImage, setAttachedImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const supportsVision = visionProviders.has(selectedProvider);
  const currentModel = selectedProvider ? (selectedModels[selectedProvider] ?? providers[selectedProvider].models[0]) : '';

  useEffect(() => { const el = messagesRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  useEffect(() => {
    try { localStorage.setItem('byoky-chat-models', JSON.stringify(selectedModels)); } catch {}
  }, [selectedModels]);

  useEffect(() => {
    if (selectedProvider) return;
    const first = providerIds.find(id => session.providers[id]?.available === true);
    setSelectedProvider(first ?? providerIds[0]);
  }, [session.providers, selectedProvider]);

  function removeAttachment() { if (attachedImage) { URL.revokeObjectURL(attachedImage.preview); setAttachedImage(null); } }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Image must be under 5MB.' }]); return; }
    setAttachedImage({ file, preview: URL.createObjectURL(file) });
    e.target.value = '';
  }

  function appendToken(text: string) {
    setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + text }; return copy; });
  }

  async function handleSend(prompt?: string) {
    const text = prompt ?? input;
    if ((!text.trim() && !attachedImage) || loading || !selectedProvider) return;

    const image = attachedImage ? { base64: await fileToBase64(attachedImage.file), mediaType: attachedImage.file.type, name: attachedImage.file.name } : undefined;
    const userMessage: Message = { role: 'user', content: text.trim() || (image ? 'What is in this image?' : ''), image };
    const prevMessages = [...messages];
    setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '', streaming: true, provider: selectedProvider }]);
    setInput('');
    removeAttachment();
    setLoading(true);

    try {
      const proxyFetch = session.createFetch(selectedProvider);

      if (selectedProvider === 'anthropic') {
        type CB = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };
        const content: CB[] = [];
        if (userMessage.image) content.push({ type: 'image', source: { type: 'base64', media_type: userMessage.image.mediaType, data: userMessage.image.base64 } });
        content.push({ type: 'text', text: userMessage.content });
        const apiMessages: Array<{ role: string; content: string | CB[] }> = prevMessages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => m.image ? { role: m.role, content: [{ type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: m.image.base64 } }, { type: 'text', text: m.content }] as CB[] } : { role: m.role, content: m.content });
        apiMessages.push({ role: 'user', content });
        const response = await proxyFetch(providers.anthropic.url, { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: currentModel, max_tokens: 4096, stream: true, messages: apiMessages }) });
        if (!response.ok) { const errText = await response.text(); let errMsg = `API error ${response.status}`; try { const parsed = JSON.parse(errText); const err = parsed.error; errMsg = [typeof err === 'string' ? err : err?.message, err?.type ? `(${err.type})` : '', `[${response.status}]`].filter(Boolean).join(' '); } catch { if (errText) errMsg += `: ${errText.slice(0, 200)}`; } throw new Error(errMsg); }
        if (response.body) { for await (const event of parseSSE(response)) { const e = event as { type?: string; delta?: { text?: string } }; if (e.type === 'content_block_delta' && e.delta?.text) appendToken(e.delta.text); } }

      } else if (selectedProvider === 'gemini') {
        type GP = { text?: string; inline_data?: { mime_type: string; data: string } };
        const parts: GP[] = [];
        if (userMessage.image) parts.push({ inline_data: { mime_type: userMessage.image.mediaType, data: userMessage.image.base64 } });
        parts.push({ text: userMessage.content });
        const apiContents = prevMessages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.image ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.base64 } } as GP, { text: m.content }] : [{ text: m.content }] }));
        apiContents.push({ role: 'user', parts });
        const response = await proxyFetch(`${providers.gemini.url}/${currentModel}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: apiContents }) });
        if (!response.ok) { const err = (await response.json()).error; throw new Error(err?.message || `API error: ${response.status}`); }
        const data = await response.json();
        appendToken(data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.');

      } else if (selectedProvider === 'openai') {
        type OB = { type: string; text?: string; image_url?: { url: string } };
        const content: OB[] = [];
        if (userMessage.image) content.push({ type: 'image_url', image_url: { url: `data:${userMessage.image.mediaType};base64,${userMessage.image.base64}` } });
        content.push({ type: 'text', text: userMessage.content });
        const apiMessages: Array<{ role: string; content: string | OB[] }> = prevMessages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => m.image ? { role: m.role, content: [{ type: 'image_url', image_url: { url: `data:${m.image.mediaType};base64,${m.image.base64}` } }, { type: 'text', text: m.content }] as OB[] } : { role: m.role, content: m.content });
        apiMessages.push({ role: 'user', content });
        const response = await proxyFetch(providers.openai.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: currentModel, messages: apiMessages, max_completion_tokens: 4096, stream: true }) });
        if (!response.ok) { const err = (await response.json()).error; throw new Error(err?.message || `API error: ${response.status}`); }
        if (response.body) { for await (const event of parseSSE(response)) { const e = event as { choices?: Array<{ delta?: { content?: string } }> }; if (e.choices?.[0]?.delta?.content) appendToken(e.choices[0].delta.content); } }

      } else if (selectedProvider in providers) {
        const allMessages = [...prevMessages, userMessage].map(m => ({ role: m.role, content: m.content }));
        const config = providers[selectedProvider];
        const response = await proxyFetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: currentModel, messages: allMessages, max_completion_tokens: 4096, stream: true }) });
        if (!response.ok) { const err = (await response.json()).error; throw new Error(err?.message || `API error: ${response.status}`); }
        if (response.body) { for await (const event of parseSSE(response)) { const e = event as { choices?: Array<{ delta?: { content?: string } }> }; if (e.choices?.[0]?.delta?.content) appendToken(e.choices[0].delta.content); } }
      }

      setMessages(prev => { const copy = [...prev]; copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: undefined }; return copy; });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => { const copy = [...prev]; const last = copy[copy.length - 1]; if (last?.streaming) { copy[copy.length - 1] = { role: 'assistant', content: `Error: ${msg}` }; } else { copy.push({ role: 'assistant', content: `Error: ${msg}` }); } return copy; });
    } finally { setLoading(false); }
  }

  return (
    <>
      <div className="header">
        <div className="provider-select">
          <label>Provider:</label>
          <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}>
            {providerIds.filter(id => session.providers[id]?.available).map(id => <option key={id} value={id}>{providers[id].name}</option>)}
          </select>
          {selectedProvider && (
            <select value={currentModel} onChange={e => setSelectedModels(prev => ({ ...prev, [selectedProvider]: e.target.value }))}>
              {providers[selectedProvider].models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
        <div className="header-actions">
          {messages.length > 0 && <button className="btn-ghost" onClick={() => setMessages([])}>Clear</button>}
          <button className="btn-ghost" onClick={onDisconnect}>Disconnect</button>
        </div>
      </div>

      <div className="messages" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <p>Start a conversation</p>
            <p className="empty-sub">Powered by your own API keys via Byoky.{supportsVision && ' Attach an image to try vision.'}</p>
            <div className="suggestions">
              {suggestedPrompts.map((prompt, i) => <button key={i} className="suggestion" onClick={() => handleSend(prompt)}>{prompt}</button>)}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}${msg.streaming ? ' message-streaming' : ''}`}>
            <div className="message-avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="message-content">
              {msg.image && <img src={`data:${msg.image.mediaType};base64,${msg.image.base64}`} alt={msg.image.name} className="message-image" />}
              {msg.role === 'assistant' ? <Markdown text={msg.content} /> : <p>{msg.content}</p>}
            </div>
          </div>
        ))}
      </div>

      {attachedImage && (
        <div className="attachment">
          <div className="attachment-preview" style={{ backgroundImage: `url(${attachedImage.preview})` }} />
          <span className="attachment-name">{attachedImage.file.name}</span>
          <button className="attachment-remove" onClick={removeAttachment}>&times;</button>
        </div>
      )}

      <form className="chat-input" onSubmit={e => { e.preventDefault(); handleSend(); }}>
        {supportsVision && (
          <>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleFileChange} hidden />
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()} disabled={loading} title="Attach image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
            </button>
          </>
        )}
        <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder={attachedImage ? 'Ask about this image...' : 'Type a message...'} disabled={loading} autoFocus />
        <button type="submit" className="btn-send" disabled={loading || (!input.trim() && !attachedImage)}>Send</button>
      </form>
    </>
  );
}
