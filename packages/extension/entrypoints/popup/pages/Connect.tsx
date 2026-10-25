import { useState } from 'react';
import { ConnectedApps } from './ConnectedApps';
import { RequestHistory } from './RequestHistory';

type ConnectTab = 'sessions' | 'history';

export function Connect() {
  const [tab, setTab] = useState<ConnectTab>('sessions');

  return (
    <div>
      <div role="tablist" className="tab-list">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'sessions'}
          className="tab-button"
          onClick={() => setTab('sessions')}
        >
          Sessions
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'history'}
          className="tab-button"
          onClick={() => setTab('history')}
        >
          History
        </button>
      </div>

      {tab === 'sessions' ? <ConnectedApps /> : <RequestHistory />}
    </div>
  );
}
