import { useEffect } from 'react';
import { useWalletStore } from './store';
import { Setup } from './pages/Setup';
import { Unlock } from './pages/Unlock';
import { Dashboard } from './pages/Dashboard';
import { AddCredential } from './pages/AddCredential';
import { RequestHistory } from './pages/RequestHistory';

export default function App() {
  const { currentPage, loading, init } = useWalletStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading && currentPage !== 'dashboard') {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="logo">byoky</h1>
        {currentPage !== 'setup' && currentPage !== 'unlock' && (
          <nav className="nav">
            <button
              className={currentPage === 'dashboard' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('dashboard')}
            >
              Wallet
            </button>
            <button
              className={currentPage === 'request-history' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('request-history')}
            >
              History
            </button>
          </nav>
        )}
      </header>
      <main className="content">
        {currentPage === 'setup' && <Setup />}
        {currentPage === 'unlock' && <Unlock />}
        {currentPage === 'dashboard' && <Dashboard />}
        {currentPage === 'add-credential' && <AddCredential />}
        {currentPage === 'request-history' && <RequestHistory />}
      </main>
    </div>
  );
}
