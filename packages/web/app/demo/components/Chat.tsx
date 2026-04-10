import { useState, useEffect, useRef, Fragment } from 'react';
import type { ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  image?: { base64: string; mediaType: string; name: string };
  streaming?: boolean;
  provider?: string;
}

interface Props {
  session: ByokySession;
}

const providers: Record<string, { url: string; model: string; name: string }> = {
  anthropic:    { url: 'https://api.anthropic.com/v1/messages',                                    model: 'claude-sonnet-4-20250514',       name: 'Anthropic (Claude)' },
  openai:       { url: 'https://api.openai.com/v1/chat/completions',                               model: 'gpt-4o',                         name: 'OpenAI (GPT-4o)' },
  gemini:       { url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', model: 'gemini-2.0-flash', name: 'Google (Gemini)' },
  groq:         { url: 'https://api.groq.com/openai/v1/chat/completions',                          model: 'llama-3.3-70b-versatile',        name: 'Groq (Llama 3.3)' },
  deepseek:     { url: 'https://api.deepseek.com/chat/completions',                                model: 'deepseek-chat',                  name: 'DeepSeek' },
  xai:          { url: 'https://api.x.ai/v1/chat/completions',                                    model: 'grok-3-mini',                    name: 'xAI (Grok)' },
  mistral:      { url: 'https://api.mistral.ai/v1/chat/completions',                               model: 'mistral-large-latest',           name: 'Mistral' },
  together:     { url: 'https://api.together.xyz/v1/chat/completions',                              model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Together AI' },
  fireworks:    { url: 'https://api.fireworks.ai/inference/v1/chat/completions',                    model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Fireworks AI' },
  perplexity:   { url: 'https://api.perplexity.ai/chat/completions',                               model: 'sonar',                          name: 'Perplexity' },
  openrouter:   { url: 'https://openrouter.ai/api/v1/chat/completions',                            model: 'anthropic/claude-sonnet-4',      name: 'OpenRouter' },
  cohere:       { url: 'https://api.cohere.com/v2/chat',                                           model: 'command-r-plus',                 name: 'Cohere' },
};

const visionProviders = new Set(['anthropic', 'openai', 'gemini']);

const suggestedPrompts = [
  'Which model are you?',
  'Explain how API keys work in 3 sentences',
  'Write a TypeScript function that reverses a string',
  'What are the main differences between REST and GraphQL?',
  'Create a haiku about open-source software',
];

const providerIds = Object.keys(providers);

function getProviderLabel(id: string): string {
  return providers[id]?.name ?? id;
}

function buildCodeSnippet(providerId: string, prompt: string): string {
  const p = providers[providerId];
  if (!p) return '';
  const msg = prompt || 'Hello!';

  if (providerId === 'anthropic') {
    return `const fetch = session.createFetch('anthropic');

const response = await fetch('${p.url}', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: '${p.model}',
    max_tokens: 1024,
    stream: true,
    messages: [{ role: 'user', content: '${msg}' }],
  }),
});`;
  }

  if (providerId === 'gemini') {
    return `const fetch = session.createFetch('gemini');

const response = await fetch(
  '${p.url}',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: '${msg}' }] }],
    }),
  },
);`;
  }

  // OpenAI-compatible providers
  return `const fetch = session.createFetch('${providerId}');

const response = await fetch('${p.url}', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: '${p.model}',
    messages: [{ role: 'user', content: '${msg}' }],
    max_completion_tokens: 1024,
    stream: true,
  }),
});`;
}

function highlightCode(code: string): React.ReactElement[] {
  const tokens: React.ReactElement[] = [];
  const re = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*')|(`(?:[^`\\]|\\.)*`)|(true|false|null|undefined)|(\b(?:const|let|var|await|new|return|if|else|function|async|import|from|export)\b)|(\b\d+\b)|([\w$.]+)|([^\w\s])|(\s+)/g;
  let match;
  let i = 0;
  while ((match = re.exec(code)) !== null) {
    const [, comment, str, tmpl, bool, keyword, num, ident, punct, ws] = match;
    let cls = '';
    if (comment) cls = 'tk-comment';
    else if (str || tmpl) cls = 'tk-string';
    else if (bool) cls = 'tk-bool';
    else if (keyword) cls = 'tk-keyword';
    else if (num) cls = 'tk-number';
    else if (ident) {
      if (ident === 'JSON' || ident === 'session' || ident === 'response') cls = 'tk-builtin';
      else if (ident.includes('.')) cls = '';
      else cls = 'tk-ident';
    } else if (punct) cls = 'tk-punct';

    tokens.push(<span key={i++} className={cls}>{match[0]}</span>);
  }
  return tokens;
}

/* ─── SSE Stream Parser ────────────────────── */

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

/* ─── Markdown Renderer ────────────────────── */

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
      if (match) {
        blocks.push(
          <pre key={si} className="md-code-block">
            {match[1] && <span className="md-code-lang">{match[1]}</span>}
            <code>{match[2].trimEnd()}</code>
          </pre>,
        );
      }
      continue;
    }

    const paragraphs = segment.split(/\n\n+/);
    for (let pi = 0; pi < paragraphs.length; pi++) {
      const para = paragraphs[pi].trim();
      if (!para) continue;
      const key = `${si}-${pi}`;
      const lines = para.split('\n');

      if (lines.every(l => !l.trim() || /^[-*]\s/.test(l.trim()))) {
        blocks.push(
          <ul key={key} className="md-list">
            {lines.filter(l => l.trim()).map((l, i) => (
              <li key={i}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>
            ))}
          </ul>,
        );
      } else if (lines.every(l => !l.trim() || /^\d+\.\s/.test(l.trim()))) {
        blocks.push(
          <ol key={key} className="md-list">
            {lines.filter(l => l.trim()).map((l, i) => (
              <li key={i}>{renderInline(l.replace(/^\d+\.\s+/, ''))}</li>
            ))}
          </ol>,
        );
      } else if (para.startsWith('### ')) {
        blocks.push(<h4 key={key} className="md-heading">{renderInline(para.slice(4))}</h4>);
      } else if (para.startsWith('## ')) {
        blocks.push(<h3 key={key} className="md-heading">{renderInline(para.slice(3))}</h3>);
      } else if (para.startsWith('# ')) {
        blocks.push(<h2 key={key} className="md-heading">{renderInline(para.slice(2))}</h2>);
      } else {
        blocks.push(
          <p key={key}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>,
        );
      }
    }
  }

  return <>{blocks}</>;
}

/* ─── Helpers ──────────────────────────────── */

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/* ─── Chat Component ──────────────────────── */

export function Chat({ session }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<{ file: File; preview: string } | null>(null);
  const [showCode, setShowCode] = useState(true);
  const [lastPrompt, setLastPrompt] = useState('Hello!');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  const supportsVision = visionProviders.has(selectedProvider);

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (selectedProvider) return;
    // Prefer a directly-available provider as the default; fall back to the
    // first in the list (so the dropdown is still populated even with zero
    // credentials, and the user can pair the wallet first then send).
    const firstDirect = providerIds.find(id => session.providers[id]?.available === true);
    setSelectedProvider(firstDirect ?? providerIds[0]);
  }, [session.providers, selectedProvider]);


  function handleAttach() { fileInputRef.current?.click(); }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: Image must be under 5MB.' }]);
      return;
    }
    setAttachedImage({ file, preview: URL.createObjectURL(file) });
    e.target.value = '';
  }

  function removeAttachment() {
    if (attachedImage) { URL.revokeObjectURL(attachedImage.preview); setAttachedImage(null); }
  }

  function appendToken(text: string) {
    setMessages(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      copy[copy.length - 1] = { ...last, content: last.content + text };
      return copy;
    });
  }

  async function handleSend(prompt?: string) {
    const text = prompt ?? input;
    if ((!text.trim() && !attachedImage) || loading || !selectedProvider) return;

    const image = attachedImage
      ? { base64: await fileToBase64(attachedImage.file), mediaType: attachedImage.file.type, name: attachedImage.file.name }
      : undefined;

    const userMessage: Message = { role: 'user', content: text.trim() || (image ? 'What is in this image?' : ''), image };
    const prevMessages = [...messages];
    setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '', streaming: true, provider: selectedProvider }]);
    setInput('');
    setLastPrompt(userMessage.content);
    removeAttachment();
    setLoading(true);

    try {
      const proxyFetch = session.createFetch(selectedProvider);
      const useStream = true;

      if (selectedProvider === 'anthropic') {
        type CB = { type: string; text?: string; source?: { type: string; media_type: string; data: string } };
        const content: CB[] = [];
        if (userMessage.image) content.push({ type: 'image', source: { type: 'base64', media_type: userMessage.image.mediaType, data: userMessage.image.base64 } });
        content.push({ type: 'text', text: userMessage.content });

        const apiMessages: Array<{ role: string; content: string | CB[] }> = prevMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => m.image
            ? { role: m.role, content: [{ type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: m.image.base64 } }, { type: 'text', text: m.content }] as CB[] }
            : { role: m.role, content: m.content },
          );
        apiMessages.push({ role: 'user', content });

        const response = await proxyFetch(providers.anthropic.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: providers.anthropic.model, max_tokens: 1024, ...(useStream && { stream: true }), messages: apiMessages }),
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMsg = `API error ${response.status}`;
          try {
            const parsed = JSON.parse(errText);
            const err = parsed.error;
            errMsg = [typeof err === 'string' ? err : err?.message, err?.type ? `(${err.type})` : '', `[${response.status}]`].filter(Boolean).join(' ');
          } catch { if (errText) errMsg += `: ${errText.slice(0, 200)}`; }
          throw new Error(errMsg);
        }

        if (useStream && response.body) {
          for await (const event of parseSSE(response)) {
            const e = event as { type?: string; delta?: { text?: string } };
            if (e.type === 'content_block_delta' && e.delta?.text) appendToken(e.delta.text);
          }
        } else {
          const data = await response.json();
          appendToken(data.content?.[0]?.text || 'No response.');
        }

      } else if (selectedProvider === 'gemini') {
        type GP = { text?: string; inline_data?: { mime_type: string; data: string } };
        const parts: GP[] = [];
        if (userMessage.image) parts.push({ inline_data: { mime_type: userMessage.image.mediaType, data: userMessage.image.base64 } });
        parts.push({ text: userMessage.content });

        const apiContents = prevMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: m.image
              ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.base64 } } as GP, { text: m.content }]
              : [{ text: m.content }],
          }));
        apiContents.push({ role: 'user', parts });

        const response = await proxyFetch(
          providers.gemini.url,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: apiContents }) },
        );
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error(err?.message || `API error: ${response.status}`);
        }
        const data = await response.json();
        appendToken(data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.');

      } else if (selectedProvider === 'openai') {
        type OB = { type: string; text?: string; image_url?: { url: string } };
        const content: OB[] = [];
        if (userMessage.image) content.push({ type: 'image_url', image_url: { url: `data:${userMessage.image.mediaType};base64,${userMessage.image.base64}` } });
        content.push({ type: 'text', text: userMessage.content });

        const apiMessages: Array<{ role: string; content: string | OB[] }> = prevMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => m.image
            ? { role: m.role, content: [{ type: 'image_url', image_url: { url: `data:${m.image.mediaType};base64,${m.image.base64}` } }, { type: 'text', text: m.content }] as OB[] }
            : { role: m.role, content: m.content },
          );
        apiMessages.push({ role: 'user', content });

        const config = providers.openai;
        const response = await proxyFetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages: apiMessages, max_completion_tokens: 1024, ...(useStream && { stream: true }) }),
        });
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error(err?.message || `API error: ${response.status}`);
        }

        if (useStream && response.body) {
          for await (const event of parseSSE(response)) {
            const e = event as { choices?: Array<{ delta?: { content?: string } }> };
            if (e.choices?.[0]?.delta?.content) appendToken(e.choices[0].delta.content);
          }
        } else {
          const data = await response.json();
          appendToken(data.choices?.[0]?.message?.content || 'No response.');
        }

      } else if (selectedProvider in providers) {
        const allMessages = [...prevMessages, userMessage].map(m => ({ role: m.role, content: m.content }));
        const config = providers[selectedProvider];
        const response = await proxyFetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages: allMessages, max_completion_tokens: 1024, ...(useStream && { stream: true }) }),
        });
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error(err?.message || `API error: ${response.status}`);
        }

        if (useStream && response.body) {
          for await (const event of parseSSE(response)) {
            const e = event as { choices?: Array<{ delta?: { content?: string } }> };
            if (e.choices?.[0]?.delta?.content) appendToken(e.choices[0].delta.content);
          }
        } else {
          const data = await response.json();
          appendToken(data.choices?.[0]?.message?.content || 'No response.');
        }

      } else {
        throw new Error(`Unsupported provider: ${selectedProvider}`);
      }

      // Mark streaming complete
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, streaming: undefined };
        return copy;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.streaming) {
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${msg}` };
        } else {
          copy.push({ role: 'assistant', content: `Error: ${msg}` });
        }
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="provider-select">
          <label>Provider:</label>
          <select value={selectedProvider} onChange={e => setSelectedProvider(e.target.value)}>
            {providerIds.map(id => (
              <option key={id} value={id}>
                {getProviderLabel(id)}
              </option>
            ))}
          </select>
        </div>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setMessages([])} style={{ padding: '6px 12px', fontSize: 12 }}>Clear</button>
          )}
          <div className="session-info">
            Session: <code>{session.sessionKey.slice(0, 12)}...</code>
          </div>
        </div>
      </div>

      <div className="chat-code-panel">
        <button className="chat-code-toggle" onClick={() => setShowCode(!showCode)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          {showCode ? 'Hide code' : 'Show code'}
        </button>
        {showCode && (
          <pre className="chat-code-snippet"><code>{highlightCode(buildCodeSnippet(selectedProvider, lastPrompt))}</code></pre>
        )}
      </div>

      <div className="chat-messages" ref={chatMessagesRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p>Start a conversation with AI</p>
            <p className="chat-empty-sub">
              Powered by Byoky — your API keys stay in the wallet.
              {supportsVision && ' Attach an image to try vision.'}
            </p>
            <div className="chat-suggestions">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  className="chat-suggestion"
                  onClick={() => handleSend(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}${msg.streaming ? ' message-streaming' : ''}`}>
            <div className="message-avatar">{msg.role === 'user' ? 'You' : msg.provider ? getProviderLabel(msg.provider).split(' ')[0] : 'AI'}</div>
            <div className="message-content">
              {msg.image && (
                <img
                  src={`data:${msg.image.mediaType};base64,${msg.image.base64}`}
                  alt={msg.image.name}
                  className="message-image"
                />
              )}
              {msg.role === 'assistant' ? <Markdown text={msg.content} /> : <p>{msg.content}</p>}
            </div>
          </div>
        ))}
      </div>

      {attachedImage && (
        <div className="chat-attachment">
          <div className="chat-attachment-preview" style={{ backgroundImage: `url(${attachedImage.preview})` }} />
          <span className="chat-attachment-name">{attachedImage.file.name}</span>
          <button className="chat-attachment-remove" onClick={removeAttachment}>&times;</button>
        </div>
      )}

      <form className="chat-input" onSubmit={e => { e.preventDefault(); handleSend(); }}>
        {supportsVision && (
          <>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={handleFileChange} hidden />
            <button type="button" className="btn btn-ghost chat-attach-btn" onClick={handleAttach} disabled={loading} title="Attach image">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
          </>
        )}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={attachedImage ? 'Ask about this image...' : 'Type a message...'}
          disabled={loading}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading || (!input.trim() && !attachedImage)}>Send</button>
      </form>
    </div>
  );
}
