'use client';

import { useState, useRef, useEffect } from 'react';
import { Byoky, type ByokySession } from '@byoky/sdk';
import { HighlightedCode } from '../../components/SyntaxHighlight';

const VAULT_URL = process.env.NEXT_PUBLIC_VAULT_URL || 'http://localhost:3100';
const WALLET_URL = process.env.NEXT_PUBLIC_WALLET_URL || 'http://localhost:3001';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function PayDemo() {
  const [session, setSession] = useState<ByokySession | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const byokyRef = useRef<Byoky | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize SDK
  useEffect(() => {
    byokyRef.current = new Byoky({
      appId: 'demo',
      vaultUrl: VAULT_URL,
      walletUrl: WALLET_URL,
    });
  }, []);

  async function connectWallet() {
    if (!byokyRef.current || connecting) return;
    setConnecting(true);
    setError(null);

    try {
      // This triggers the extension's connect flow:
      // - If extension installed → shows approval popup in extension
      // - If not installed → shows modal with install link / QR for mobile
      const sess = await byokyRef.current.connect({
        providers: [{ id: 'gemini', required: true }],
        modal: true,
      });
      setSession(sess);

      // Fetch balance from vault
      try {
        const bal = await byokyRef.current.getBalance();
        if (bal) setBalance(bal.amountCents);
      } catch {
        // Balance fetch is non-critical
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
    }
    setConnecting(false);
  }

  async function sendMessage() {
    if (!input.trim() || !session || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // Use the SDK's proxied fetch — routes through extension → vault → Gemini
      const proxyFetch = session.createFetch('gemini');

      const contents = [...messages, { role: 'user', content: userMsg }].map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      const resp = await proxyFetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents }),
        },
      );

      const data = await resp.json() as {
        candidates?: Array<{ content: { parts: Array<{ text: string }> } }>;
        error?: { message: string; code: string };
      };

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        setMessages((prev) => [...prev, { role: 'assistant', content: text }]);
      } else {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Error: ${data.error?.message ?? 'No response from model'}`,
        }]);
      }

      // Refresh balance
      try {
        const usage = await session.getUsage();
        if (usage.costCents != null) {
          setBalance((prev) => prev != null ? prev - (usage.costCents ?? 0) : null);
        }
      } catch {
        // Usage fetch non-critical
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
    setLoading(false);
  }

  const connected = session != null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sora), -apple-system, sans-serif' }}>
      {/* Balance bar — only when connected */}
      {connected && (
        <div style={{
          padding: '8px 24px',
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
              Wallet connected
            </span>
            {balance !== null && (
              <span style={{ marginLeft: '12px', color: 'var(--teal)', fontWeight: 600 }}>
                ${(balance / 100).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 53px)' }}>
        {/* Not connected — show paywall */}
        {!connected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', maxWidth: '400px' }}>
              <a href="/demo" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', textDecoration: 'none', fontSize: '13px', marginBottom: '16px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
                Back to Demo
              </a>
              <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px' }}>DemoChat</h1>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>
                An AI chat app that costs the developer $0. Users pay from their Byoky wallet.
              </p>

              {error && (
                <div style={{
                  marginBottom: '16px', padding: '10px 14px', borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px',
                }}>
                  {error}
                </div>
              )}

              {/* The PayButton */}
              <button
                onClick={connectWallet}
                disabled={connecting}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '10px',
                  padding: '14px 28px', borderRadius: '12px',
                  background: connecting ? 'var(--border-hover)' : 'var(--teal)',
                  color: '#fff', border: 'none',
                  fontSize: '16px', fontWeight: 600,
                  cursor: connecting ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s',
                  boxShadow: connecting ? 'none' : '0 4px 12px rgba(14, 165, 233, 0.3)',
                }}
              >
                {connecting ? (
                  <>
                    <span style={{
                      width: '18px', height: '18px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: '#fff', borderRadius: '50%',
                      animation: 'spin 0.6s linear infinite',
                    }} />
                    Connecting...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                      <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                    </svg>
                    Pay with Byoky — 50% off
                  </>
                )}
              </button>

              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px' }}>
                One wallet, every AI app. No API keys needed.
              </p>

              {/* Developer code snippet — always visible */}
              <div style={{ marginTop: '32px', textAlign: 'left' }}>
                <div style={{
                  borderRadius: '12px', overflow: 'hidden',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '10px 16px', background: 'rgba(0,0,0,0.2)',
                  }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f57' }} />
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#febc2e' }} />
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c840' }} />
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#7a7a9c', fontFamily: 'var(--font-mono, monospace)' }}>app.ts</span>
                  </div>
                  <pre style={{
                    background: '#1a1a2e', padding: '16px', margin: 0,
                    fontSize: '12px', fontFamily: 'var(--font-mono, monospace)',
                    lineHeight: 1.7, overflow: 'auto', color: '#e2e2ec',
                  }}>
                    <HighlightedCode code={`import { Byoky, PayButton } from '@byoky/sdk';

const byoky = new Byoky({
  appId: 'app_your_id_here'
});

// That's it. Two lines to add AI payments.
PayButton.mount('#paywall', {
  byoky,
  onSession: (session) => {
    const fetch = session.createFetch('gemini');
    // Every API call is paid by the user's wallet
    // Developer pays $0 for inference
  }
});`} />
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connected — show chat */}
        {connected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <a href="/demo" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', textDecoration: 'none', fontSize: '13px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
                Back to Demo
              </a>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>DemoChat</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '80px' }}>
                  <p style={{ fontSize: '15px' }}>Ask me anything. Each message costs a fraction of a cent.</p>
                  <p style={{ fontSize: '12px', marginTop: '8px' }}>Powered by Gemini 2.0 Flash via Byoky</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{
                    maxWidth: '80%',
                    padding: '12px 16px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'var(--teal)' : 'var(--bg-elevated)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text)',
                    fontSize: '14px', lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', marginBottom: '12px' }}>
                  <div style={{
                    padding: '12px 16px', borderRadius: '16px 16px 16px 4px',
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: '14px',
                  }}>
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
              style={{ display: 'flex', gap: '8px' }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                disabled={loading}
                autoFocus
                style={{
                  flex: 1, padding: '14px 18px',
                  borderRadius: '12px', border: '1px solid var(--border)',
                  background: 'var(--bg-surface)', color: 'var(--text)',
                  fontSize: '14px', outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                style={{
                  padding: '14px 20px', borderRadius: '12px',
                  background: loading || !input.trim() ? 'var(--bg-elevated)' : 'var(--teal)',
                  color: '#fff', border: 'none',
                  fontSize: '14px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
