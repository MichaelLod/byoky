import { useWalletStore } from '../store';
import { PROVIDERS, familyOf, type RequestLogEntry } from '@byoky/core';

// The log keeps the last 500 requests, so older days show up too.
function formatWhen(timestamp: number): string {
  const when = new Date(timestamp);
  return when.toDateString() === new Date().toDateString()
    ? when.toLocaleTimeString()
    : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Where a routed request went, for a request that went to another provider
 * than the app asked for (F065): the arrow's label and its title, worded as
 * on the Connect page's sessions.
 */
function routeOf(entry: RequestLogEntry): { label: string; title: string } | undefined {
  const actual = entry.actualProviderId;
  if (!actual || actual === entry.providerId) return undefined;
  const label = PROVIDERS[actual]?.name ?? actual;
  const translated = familyOf(entry.providerId) !== familyOf(actual);
  return {
    label,
    title: translated ? `Translated to ${label}${entry.actualModel ? ` (${entry.actualModel})` : ''}` : `Routed to ${label}`,
  };
}

/** The model the app asked for, and the one that served it when another did. */
function modelOf(entry: RequestLogEntry): string | undefined {
  if (entry.model && entry.actualModel && entry.actualModel !== entry.model) return `${entry.model} → ${entry.actualModel}`;
  return entry.actualModel ?? entry.model;
}

export function RequestHistory() {
  const { requestLog } = useWalletStore();

  return (
    <div>
      <h2 className="page-title">Request History</h2>

      {requestLog.length === 0 ? (
        <div className="empty-state">
          <p>No requests yet.</p>
          <p>Requests made through Byoky will appear here.</p>
        </div>
      ) : (
        <div className="log-block">
          {requestLog.map((entry) => {
            const provider = PROVIDERS[entry.providerId];
            const route = routeOf(entry);
            const model = modelOf(entry);
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
                      {route && (
                        <span className="route-indicator" title={route.title}>
                          {' → '}{route.label}
                        </span>
                      )}
                    </span>
                    <span className={`log-status ${statusClass}`}>
                      {entry.status}
                    </span>
                  </div>
                  <div className="log-meta">
                    {model && <>{model} &middot;{' '}</>}
                    {entry.appOrigin} &middot;{' '}
                    {formatWhen(entry.timestamp)}
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
