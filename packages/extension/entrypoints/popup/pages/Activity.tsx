import { useState } from 'react';
import { ConnectedApps } from './ConnectedApps';
import { RequestHistory } from './RequestHistory';

type ActivityTab = 'active' | 'history';

export function Activity() {
  const [tab, setTab] = useState<ActivityTab>('active');

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
          aria-selected={tab === 'active'}
          className="tab-button"
          onClick={() => setTab('active')}
          style={{
            flex: 1,
            padding: '10px 8px',
            background: 'none',
            border: 'none',
            borderBottom: `2px solid ${tab === 'active' ? 'var(--accent)' : 'transparent'}`,
            color: tab === 'active' ? 'var(--text)' : 'var(--text-muted)',
            fontSize: '13px',
            fontWeight: tab === 'active' ? 600 : 400,
            cursor: 'pointer',
          }}
        >
          Active
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

      {tab === 'active' ? <ConnectedApps /> : <RequestHistory />}
    </div>
  );
}
