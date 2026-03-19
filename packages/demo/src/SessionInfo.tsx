import { useState, useEffect } from 'react';
import type { ByokySession, SessionUsage } from '@byoky/sdk';

interface Props {
  session: ByokySession;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function SessionInfo({ session }: Props) {
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        session.getUsage(),
        session.isConnected(),
      ]);
      setUsage(u);
      setConnected(c);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const providers = Object.entries(session.providers)
    .filter(([, v]) => v.available)
    .map(([id]) => id);

  return (
    <div className="demo-panel">
      <div className="demo-header">
        <h3>Session Info</h3>
        <button
          className="btn btn-ghost"
          onClick={refresh}
          disabled={loading}
          style={{ padding: '6px 12px', fontSize: '12px', width: 'auto' }}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <p className="demo-desc">
        Your app can query its own session status and usage via the SDK.
        This data comes from <code>session.getUsage()</code> and <code>session.isConnected()</code>.
      </p>

      <div className="session-grid">
        <div className="session-card">
          <div className="session-card-label">Status</div>
          <div className="session-card-value">
            {connected === null ? '...' : connected ? (
              <><span className="session-dot connected" /> Connected</>
            ) : (
              <><span className="session-dot disconnected" /> Disconnected</>
            )}
          </div>
        </div>
        <div className="session-card">
          <div className="session-card-label">Session Key</div>
          <div className="session-card-value mono">
            {session.sessionKey.slice(0, 16)}...
          </div>
        </div>
        <div className="session-card">
          <div className="session-card-label">Providers</div>
          <div className="session-card-value">
            {providers.length > 0 ? providers.join(', ') : 'None'}
          </div>
        </div>
        <div className="session-card">
          <div className="session-card-label">Requests</div>
          <div className="session-card-value">{usage?.requests ?? '...'}</div>
        </div>
        <div className="session-card">
          <div className="session-card-label">Input Tokens</div>
          <div className="session-card-value">
            {usage ? formatTokens(usage.inputTokens) : '...'}
          </div>
        </div>
        <div className="session-card">
          <div className="session-card-label">Output Tokens</div>
          <div className="session-card-value">
            {usage ? formatTokens(usage.outputTokens) : '...'}
          </div>
        </div>
      </div>

      {usage && Object.keys(usage.byProvider).length > 0 && (
        <>
          <h4 className="session-section-title">By Provider</h4>
          <div className="session-providers">
            {Object.entries(usage.byProvider).map(([id, stats]) => (
              <div key={id} className="session-provider-row">
                <span className="session-provider-name">{id}</span>
                <span className="session-provider-stats">
                  {stats.requests} req · {formatTokens(stats.inputTokens)} in · {formatTokens(stats.outputTokens)} out
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="session-code-hint">
        <div className="code-window" style={{ marginTop: '16px' }}>
          <div className="code-titlebar">
            <span className="code-dot red" />
            <span className="code-dot yellow" />
            <span className="code-dot green" />
            <span className="code-filename">session-api.ts</span>
          </div>
          <pre className="code-body"><code>{`// Check connection status
const connected = await session.isConnected();

// Get this session's usage
const usage = await session.getUsage();
console.log(usage.requests, usage.inputTokens);

// Listen for disconnects
session.onDisconnect(() => {
  showReconnectPrompt();
});`}</code></pre>
        </div>
      </div>
    </div>
  );
}
