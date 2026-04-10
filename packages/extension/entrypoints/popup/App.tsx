import { useEffect } from 'react';
import { useWalletStore } from './store';
import { Setup } from './pages/Setup';
import { Unlock } from './pages/Unlock';
import { Dashboard } from './pages/Dashboard';
import { AddCredential } from './pages/AddCredential';
import { ConnectedApps } from './pages/ConnectedApps';
import { ApprovalRequest } from './pages/ApprovalRequest';
import { Usage } from './pages/Usage';
import { RequestHistory } from './pages/RequestHistory';
import { Settings } from './pages/Settings';
import { Gifts } from './pages/Gifts';
import { CreateGift } from './pages/CreateGift';
import { RedeemGift } from './pages/RedeemGift';
import { Apps } from './pages/Apps';
import { AppStore } from './pages/AppStore';
import { AppView } from './pages/AppView';

export default function App() {
  const { currentPage, sessions, pendingApprovals, loading, init } = useWalletStore();

  useEffect(() => {
    init();
  }, [init]);

  // Listen for new pending approvals from background
  useEffect(() => {
    function listener(message: unknown) {
      const msg = message as Record<string, string> | null;
      if (!msg || msg.type !== 'BYOKY_INTERNAL') return;
      if (msg.action === 'newPendingApproval') {
        useWalletStore.getState().refreshData().then(() => {
          if (useWalletStore.getState().pendingApprovals.length > 0) {
            useWalletStore.getState().navigate('approval');
          }
        });
      } else if (msg.action === 'sessionChanged' || msg.action === 'usageUpdated') {
        useWalletStore.getState().refreshData();
      }
    }
    try {
      browser.runtime.onMessage.addListener(listener);
      return () => browser.runtime.onMessage.removeListener(listener);
    } catch {
      // Side panel may not support onMessage in all contexts
    }
  }, []);

  if (loading && currentPage !== 'dashboard') {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const showNav = currentPage !== 'setup' && currentPage !== 'unlock' && currentPage !== 'approval';

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">Byoky</h1>
        {showNav && (
          <nav className="nav">
            <button
              className={currentPage === 'dashboard' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('dashboard')}
              title="Wallet"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
              </svg>
            </button>
            <button
              className={currentPage === 'gifts' || currentPage === 'create-gift' || currentPage === 'redeem-gift' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('gifts')}
              title="Gifts"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12v10H4V12" />
                <path d="M2 7h20v5H2z" />
                <path d="M12 22V7" />
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
              </svg>
            </button>
            <button
              className={currentPage === 'apps' || currentPage === 'app-store' || currentPage === 'app-view' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('apps')}
              title="Apps"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="9" height="9" rx="2" />
                <rect x="13" y="2" width="9" height="9" rx="2" />
                <rect x="2" y="13" width="9" height="9" rx="2" />
                <rect x="13" y="13" width="9" height="9" rx="2" />
              </svg>
            </button>
            <button
              className={currentPage === 'connected-apps' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('connected-apps')}
              title="Sessions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              {sessions.length > 0 && (
                <span className="nav-badge">{sessions.length}</span>
              )}
            </button>
            <button
              className={currentPage === 'usage' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('usage')}
              title="Usage"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 20V10" />
                <path d="M12 20V4" />
                <path d="M6 20v-6" />
              </svg>
            </button>
            <button
              className={currentPage === 'request-history' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('request-history')}
              title="History"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button
              className={currentPage === 'settings' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('settings')}
              title="Settings"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </nav>
        )}
      </header>
      <main className="content">
        <div key={currentPage} className="page-enter">
          {currentPage === 'setup' && <Setup />}
          {currentPage === 'unlock' && <Unlock />}
          {currentPage === 'dashboard' && <Dashboard />}
          {currentPage === 'add-credential' && <AddCredential />}
          {currentPage === 'connected-apps' && <ConnectedApps />}
          {currentPage === 'approval' && <ApprovalRequest />}
          {currentPage === 'usage' && <Usage />}
          {currentPage === 'request-history' && <RequestHistory />}
          {currentPage === 'settings' && <Settings />}
          {currentPage === 'gifts' && <Gifts />}
          {currentPage === 'create-gift' && <CreateGift />}
          {currentPage === 'redeem-gift' && <RedeemGift />}
          {currentPage === 'apps' && <Apps />}
          {currentPage === 'app-store' && <AppStore />}
          {currentPage === 'app-view' && <AppView />}
        </div>
      </main>
      {(currentPage === 'setup' || currentPage === 'unlock') && (
        <div className="mascot-peek">
          <img src="/mascot.svg" alt="" />
        </div>
      )}
    </div>
  );
}
