import { useState, useEffect, useRef } from 'react';
import type { ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  image?: { base64: string; mediaType: string; name: string };
}

interface Props {
  session: ByokySession;
}

const openaiCompatible: Record<string, { url: string; model: string; name: string }> = {
  openai:       { url: 'https://api.openai.com/v1/chat/completions',       model: 'gpt-4o',                        name: 'OpenAI (GPT-4o)' },
  groq:         { url: 'https://api.groq.com/openai/v1/chat/completions',  model: 'llama-3.3-70b-versatile',       name: 'Groq (Llama 3.3)' },
  deepseek:     { url: 'https://api.deepseek.com/chat/completions',        model: 'deepseek-chat',                 name: 'DeepSeek' },
  xai:          { url: 'https://api.x.ai/v1/chat/completions',             model: 'grok-3-mini',                   name: 'xAI (Grok)' },
  mistral:      { url: 'https://api.mistral.ai/v1/chat/completions',       model: 'mistral-large-latest',          name: 'Mistral' },
  together:     { url: 'https://api.together.xyz/v1/chat/completions',     model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Together AI' },
  fireworks:    { url: 'https://api.fireworks.ai/inference/v1/chat/completions', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Fireworks AI' },
  perplexity:   { url: 'https://api.perplexity.ai/chat/completions',       model: 'sonar',                         name: 'Perplexity' },
  openrouter:   { url: 'https://openrouter.ai/api/v1/chat/completions',    model: 'anthropic/claude-sonnet-4',     name: 'OpenRouter' },
  cohere:       { url: 'https://api.cohere.com/v2/chat',                   model: 'command-r-plus',                name: 'Cohere' },
};

const visionProviders = new Set(['anthropic', 'openai', 'gemini']);

function getProviderLabel(id: string): string {
  if (id === 'anthropic') return 'Anthropic (Claude)';
  if (id === 'gemini') return 'Google (Gemini)';
  return openaiCompatible[id]?.name ?? id;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function Chat({ session }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableProviders = Object.entries(session.providers)
    .filter(([, v]) => v.available)
    .map(([id]) => id);

  const supportsVision = visionProviders.has(selectedProvider);

  useEffect(() => {
    if (availableProviders.length > 0 && !selectedProvider) {
      setSelectedProvider(availableProviders[0]);
    }
  }, [availableProviders, selectedProvider]);

  function handleAttach() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error: Image must be under 5MB.' }]);
      return;
    }
    const preview = URL.createObjectURL(file);
    setAttachedImage({ file, preview });
    e.target.value = '';
  }

  function removeAttachment() {
    if (attachedImage) {
      URL.revokeObjectURL(attachedImage.preview);
      setAttachedImage(null);
    }
  }

  async function handleSend() {
    if ((!input.trim() && !attachedImage) || loading || !selectedProvider) return;

    const image = attachedImage
      ? { base64: await fileToBase64(attachedImage.file), mediaType: attachedImage.file.type, name: attachedImage.file.name }
      : undefined;

    const userMessage: Message = { role: 'user', content: input.trim() || (image ? 'What is in this image?' : ''), image };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    removeAttachment();
    setLoading(true);

    try {
      const proxyFetch = session.createFetch(selectedProvider);

      let assistantContent = '';

      if (selectedProvider === 'anthropic') {
        const content: unknown[] = [];
        if (userMessage.image) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: userMessage.image.mediaType, data: userMessage.image.base64 },
          });
        }
        content.push({ type: 'text', text: userMessage.content });

        const apiMessages = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => {
            if (m.image) {
              return {
                role: m.role,
                content: [
                  { type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: m.image.base64 } },
                  { type: 'text', text: m.content },
                ],
              };
            }
            return { role: m.role, content: m.content };
          });
        apiMessages.push({ role: 'user', content });

        const response = await proxyFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: apiMessages }),
        });
        const text = await response.text();
        if (!response.ok) {
          let errMsg = `API error ${response.status}`;
          try {
            const parsed = JSON.parse(text);
            const err = parsed.error;
            const msg = typeof err === 'string' ? err : err?.message;
            const errType = typeof err === 'object' ? err?.type : undefined;
            errMsg = [msg, errType ? `(${errType})` : '', `[${response.status}]`].filter(Boolean).join(' ');
          } catch {
            if (text) errMsg += `: ${text.slice(0, 200)}`;
          }
          throw new Error(errMsg);
        }
        const data = JSON.parse(text);
        assistantContent = data.content?.[0]?.text || 'No response.';
      } else if (selectedProvider === 'gemini') {
        const parts: unknown[] = [];
        if (userMessage.image) {
          parts.push({ inline_data: { mime_type: userMessage.image.mediaType, data: userMessage.image.base64 } });
        }
        parts.push({ text: userMessage.content });

        const apiContents = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: m.image
              ? [{ inline_data: { mime_type: m.image.mediaType, data: m.image.base64 } }, { text: m.content }]
              : [{ text: m.content }],
          }));
        apiContents.push({ role: 'user', parts });

        const response = await proxyFetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contents: apiContents }),
          },
        );
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error((typeof err === 'string' ? err : err?.message) || `API error: ${response.status}`);
        }
        const data = await response.json();
        assistantContent = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
      } else if (selectedProvider === 'openai') {
        const content: unknown[] = [];
        if (userMessage.image) {
          content.push({ type: 'image_url', image_url: { url: `data:${userMessage.image.mediaType};base64,${userMessage.image.base64}` } });
        }
        content.push({ type: 'text', text: userMessage.content });

        const apiMessages = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => {
            if (m.image) {
              return {
                role: m.role,
                content: [
                  { type: 'image_url', image_url: { url: `data:${m.image.mediaType};base64,${m.image.base64}` } },
                  { type: 'text', text: m.content },
                ],
              };
            }
            return { role: m.role, content: m.content };
          });
        apiMessages.push({ role: 'user', content });

        const config = openaiCompatible.openai;
        const response = await proxyFetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages: apiMessages, max_tokens: 1024 }),
        });
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error((typeof err === 'string' ? err : err?.message) || `API error: ${response.status}`);
        }
        const data = await response.json();
        assistantContent = data.choices?.[0]?.message?.content || 'No response.';
      } else if (selectedProvider in openaiCompatible) {
        const allMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const config = openaiCompatible[selectedProvider];
        const response = await proxyFetch(config.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: config.model, messages: allMessages, max_tokens: 1024 }),
        });
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error((typeof err === 'string' ? err : err?.message) || `API error: ${response.status}`);
        }
        const data = await response.json();
        assistantContent = data.choices?.[0]?.message?.content || 'No response.';
      } else {
        throw new Error(`Unsupported provider: ${selectedProvider}`);
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: assistantContent }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${msg || 'Unknown error'}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="provider-select">
          <label>Provider:</label>
          <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
            {availableProviders.map((id) => (
              <option key={id} value={id}>{getProviderLabel(id)}</option>
            ))}
          </select>
        </div>
        <div className="session-info">
          Session: <code>{session.sessionKey.slice(0, 12)}...</code>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Send a message to start chatting.</p>
            <p className="chat-empty-sub">
              Powered by Byoky — your API keys stay in the wallet extension.
              {supportsVision && ' Attach an image to try vision.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="message-content">
              {msg.image && (
                <img
                  src={`data:${msg.image.mediaType};base64,${msg.image.base64}`}
                  alt={msg.image.name}
                  className="message-image"
                />
              )}
              <p>{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message message-assistant">
            <div className="message-avatar">AI</div>
            <div className="message-content">
              <div className="typing-indicator"><span /><span /><span /></div>
            </div>
          </div>
        )}
      </div>

      {attachedImage && (
        <div className="chat-attachment">
          <img src={attachedImage.preview} alt="Attached" className="chat-attachment-preview" />
          <span className="chat-attachment-name">{attachedImage.file.name}</span>
          <button className="chat-attachment-remove" onClick={removeAttachment}>&times;</button>
        </div>
      )}

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        {supportsVision && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleFileChange}
              hidden
            />
            <button
              type="button"
              className="btn btn-ghost chat-attach-btn"
              onClick={handleAttach}
              disabled={loading}
              title="Attach image"
            >
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
          onChange={(e) => setInput(e.target.value)}
          placeholder={attachedImage ? 'Ask about this image...' : 'Type a message...'}
          disabled={loading}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading || (!input.trim() && !attachedImage)}>Send</button>
      </form>
    </div>
  );
}
