import { useState, useRef, useEffect } from 'react';
import type { ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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

function getProviderLabel(id: string): string {
  if (id === 'anthropic') return 'Anthropic (Claude)';
  if (id === 'gemini') return 'Google (Gemini)';
  return openaiCompatible[id]?.name ?? id;
}

export function Chat({ session }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const availableProviders = Object.entries(session.providers)
    .filter(([, v]) => v.available)
    .map(([id]) => id);

  useEffect(() => {
    if (availableProviders.length > 0 && !selectedProvider) {
      setSelectedProvider(availableProviders[0]);
    }
  }, [availableProviders, selectedProvider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || loading || !selectedProvider) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const proxyFetch = session.createFetch(selectedProvider);
      const allMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let assistantContent = '';

      if (selectedProvider === 'anthropic') {
        const response = await proxyFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, messages: allMessages }),
        });
        const text = await response.text();
        if (!response.ok) {
          let errMsg = `API error: ${response.status}`;
          try {
            const parsed = JSON.parse(text);
            const err = parsed.error;
            errMsg = (typeof err === 'string' ? err : err?.message) || errMsg;
          } catch {}
          throw new Error(errMsg);
        }
        const data = JSON.parse(text);
        assistantContent = data.content?.[0]?.text || 'No response.';
      } else if (selectedProvider === 'gemini') {
        const response = await proxyFetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: allMessages.map((m) => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              })),
            }),
          },
        );
        if (!response.ok) {
          const err = (await response.json()).error;
          throw new Error((typeof err === 'string' ? err : err?.message) || `API error: ${response.status}`);
        }
        const data = await response.json();
        assistantContent = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
      } else if (selectedProvider in openaiCompatible) {
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
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${(e as Error).message}` }]);
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
            <p className="chat-empty-sub">Powered by Byoky — your API keys stay in the wallet extension.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-avatar">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="message-content"><p>{msg.content}</p></div>
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
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={loading}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>Send</button>
      </form>
    </div>
  );
}
