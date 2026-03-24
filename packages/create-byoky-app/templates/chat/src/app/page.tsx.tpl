'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { Byoky, isExtensionInstalled, getStoreUrl } from '@byoky/sdk';
import type { ByokySession } from '@byoky/sdk';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const byoky = new Byoky();

export default function Home() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleConnect = async () => {
    setError(null);
    setIsConnecting(true);
    try {
      const s = await byoky.connect({
        providers: [{ id: 'anthropic', required: true }],
        modal: true,
      });
      setSession(s);
      s.onDisconnect(() => {
        setSession(null);
        setError('Wallet disconnected');
      });
    } catch (err) {
      if (!isExtensionInstalled()) {
        const url = getStoreUrl();
        setError(
          url
            ? 'Byoky wallet not found. Install the extension to continue.'
            : 'Byoky wallet not found.'
        );
      } else if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleSend = async () => {
    if (!session || !input.trim() || isStreaming) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);
    setError(null);

    try {
      const proxyFetch = session.createFetch('anthropic');
      const client = new Anthropic({
        apiKey: 'byoky',
        fetch: proxyFetch,
        dangerouslyAllowBrowser: true,
      });

      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages([...updatedMessages, assistantMessage]);

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          assistantMessage.content += event.delta.text;
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { ...assistantMessage },
          ]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!session) {
    return (
      <div style={styles.connectContainer}>
        <h1 style={styles.title}>{{PROJECT_NAME}}</h1>
        <p style={styles.subtitle}>AI chat powered by your own API keys</p>
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          style={{
            ...styles.connectButton,
            opacity: isConnecting ? 0.6 : 1,
          }}
        >
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
        {error && <p style={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={styles.chatContainer}>
      <header style={styles.header}>
        <h1 style={styles.headerTitle}>{{PROJECT_NAME}}</h1>
        <div style={styles.headerRight}>
          <span style={styles.status}>Connected</span>
          <button
            onClick={() => {
              session.disconnect();
              setSession(null);
              setMessages([]);
            }}
            style={styles.disconnectButton}
          >
            Disconnect
          </button>
        </div>
      </header>

      <div style={styles.messagesContainer}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyText}>Send a message to start chatting</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              backgroundColor:
                msg.role === 'user'
                  ? 'var(--user-bg)'
                  : 'var(--assistant-bg)',
            }}
          >
            <div style={styles.messageRole}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div style={styles.messageContent}>{msg.content}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputContainer}>
        {error && <p style={styles.inlineError}>{error}</p>}
        <div style={styles.inputRow}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            style={styles.textarea}
          />
          <button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
            style={{
              ...styles.sendButton,
              opacity: isStreaming || !input.trim() ? 0.5 : 1,
            }}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  connectContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: '16px',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: '1.1rem',
    marginBottom: '8px',
  },
  connectButton: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    color: '#f87171',
    fontSize: '0.9rem',
    maxWidth: '400px',
    textAlign: 'center' as const,
  },
  chatContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    maxWidth: '800px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    borderBottom: '1px solid var(--border)',
  },
  headerTitle: {
    fontSize: '1.1rem',
    fontWeight: 600,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  status: {
    color: '#4ade80',
    fontSize: '0.85rem',
  },
  disconnectButton: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  messagesContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  emptyText: {
    color: 'var(--text-muted)',
  },
  message: {
    padding: '16px 20px',
    borderRadius: '8px',
    marginBottom: '12px',
  },
  messageRole: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  messageContent: {
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
  },
  inputContainer: {
    padding: '16px 24px',
    borderTop: '1px solid var(--border)',
  },
  inlineError: {
    color: '#f87171',
    fontSize: '0.85rem',
    marginBottom: '8px',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
  },
  textarea: {
    flex: 1,
    background: 'var(--bg-tertiary)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '1rem',
    resize: 'none' as const,
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendButton: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
};
