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
        requestLog.map((entry) => {
          const provider = PROVIDERS[entry.providerId];
          const isError = entry.status >= 400;
          const isRateLimit = entry.status === 429;

          return (
            <div key={entry.id} className="log-entry">
              <span
                className={`status-dot ${isError ? (isRateLimit ? 'warning' : 'error') : 'success'}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500, fontSize: '13px' }}>
                    {entry.method} {provider?.name ?? entry.providerId}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {entry.status}
                  </span>
                </div>
                <div className="log-meta">
                  {entry.appOrigin} &middot;{' '}
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
                {entry.error && (
                  <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '2px' }}>
                    {entry.error}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
