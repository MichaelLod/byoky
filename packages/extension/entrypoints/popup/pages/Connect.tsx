import { useState } from 'react';
import { ConnectedApps } from './ConnectedApps';
import { RequestHistory } from './RequestHistory';

type ConnectTab = 'sessions' | 'history';

export function Connect() {
  const [tab, setTab] = useState<ConnectTab>('sessions');

  return (
    <div>
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '12px',
          borderBottom: '1px solid var(--border, #333)',
        }}
      >
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'sessions'}
          className="tab-button"
          onClick={() => setTab('sessions')}
          style={{
            flex: 1,
            padding: '10px 8px',
            background: 'none',
            border: 'none',
            borderBottom: `2px solid ${tab === 'sessions' ? 'var(--accent)' : 'transparent'}`,
            color: tab === 'sessions' ? 'var(--text)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: tab === 'sessions' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Sessions
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'history'}
          className="tab-button"
          onClick={() => setTab('history')}
          style={{
            flex: 1,
            padding: '10px 8px',
            background: 'none',
            border: 'none',
            borderBottom: `2px solid ${tab === 'history' ? 'var(--accent)' : 'transparent'}`,
            color: tab === 'history' ? 'var(--text)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: tab === 'history' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          History
        </button>
      </div>

      {tab === 'sessions' ? <ConnectedApps /> : <RequestHistory />}
    </div>
  );
}
