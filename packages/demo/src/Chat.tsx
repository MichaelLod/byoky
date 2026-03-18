import { useState, useRef, useEffect } from 'react';
import type { ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  session: ByokySession;
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

      let response: Response;

      if (selectedProvider === 'anthropic') {
        response = await proxyFetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            messages: allMessages,
          }),
        });
      } else if (selectedProvider === 'openai') {
        response = await proxyFetch(
          'https://api.openai.com/v1/chat/completions',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o',
              messages: allMessages,
              max_tokens: 1024,
            }),
          },
        );
      } else if (selectedProvider === 'gemini') {
        response = await proxyFetch(
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
      } else {
        throw new Error(`Unknown provider: ${selectedProvider}`);
      }

      if (!response.ok) {
        const err = await response.json();
        throw new Error(
          err.error?.message || err.message || `API error: ${response.status}`,
        );
      }

      const data = await response.json();
      let assistantContent = '';

      if (selectedProvider === 'anthropic') {
        assistantContent =
          data.content?.[0]?.text || 'No response from Claude.';
      } else if (selectedProvider === 'openai') {
        assistantContent =
          data.choices?.[0]?.message?.content || 'No response from OpenAI.';
      } else if (selectedProvider === 'gemini') {
        assistantContent =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          'No response from Gemini.';
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistantContent },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${(e as Error).message}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <div className="provider-select">
          <label>Provider:</label>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
          >
            {availableProviders.map((id) => (
              <option key={id} value={id}>
                {id === 'anthropic'
                  ? 'Anthropic (Claude)'
                  : id === 'openai'
                    ? 'OpenAI (GPT-4o)'
                    : id === 'gemini'
                      ? 'Google (Gemini)'
                      : id}
              </option>
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
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            <div className="message-content">
              <p>{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="message message-assistant">
            <div className="message-avatar">AI</div>
            <div className="message-content">
              <div className="typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={loading}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
