import { useWalletStore } from '../store';
import { PROVIDERS } from '@byoky/core';

export function RequestHistory() {
  const { requestLog } = useWalletStore();

  return (
    <div>
      <h2 className="page-title">Request History</h2>

      {requestLog.length === 0 ? (
        <div className="empty-state">
          <p>No requests yet.</p>
          <p>Requests made through byoky will appear here.</p>
        </div>
      ) : (
        <div className="log-block">
          {requestLog.map((entry) => {
            const provider = PROVIDERS[entry.providerId];
            const isError = entry.status >= 400;
            const isRateLimit = entry.status === 429;
            const statusClass = isError ? (isRateLimit ? 'rate-limited' : 'failed') : '';

            return (
              <div key={entry.id} className="log-entry">
                <div className={`log-dot ${statusClass}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ color: 'var(--text)' }}>
                      {entry.method} {provider?.name ?? entry.providerId}
                    </span>
                    <span className={`log-status ${statusClass}`}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="log-meta">
                    {entry.appOrigin} &middot;{' '}
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                  {entry.error && (
                    <div className="log-error">
                      {entry.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
