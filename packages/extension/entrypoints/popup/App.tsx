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
      } else if (msg.action === 'sessionChanged') {
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
            >
              Wallet
            </button>
            <button
              className={currentPage === 'connected-apps' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('connected-apps')}
            >
              Apps
              {sessions.length > 0 && (
                <span className="nav-badge">{sessions.length}</span>
              )}
            </button>
            <button
              className={currentPage === 'usage' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('usage')}
            >
              Usage
            </button>
            <button
              className={currentPage === 'request-history' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('request-history')}
            >
              History
            </button>
            <button
              className={currentPage === 'settings' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('settings')}
              title="Settings"
            >
              Settings
            </button>
          </nav>
        )}
      </header>
      <main className="content">
        {currentPage === 'setup' && <Setup />}
        {currentPage === 'unlock' && <Unlock />}
        {currentPage === 'dashboard' && <Dashboard />}
        {currentPage === 'add-credential' && <AddCredential />}
        {currentPage === 'connected-apps' && <ConnectedApps />}
        {currentPage === 'approval' && <ApprovalRequest />}
        {currentPage === 'usage' && <Usage />}
        {currentPage === 'request-history' && <RequestHistory />}
        {currentPage === 'settings' && <Settings />}
      </main>
    </div>
  );
}
