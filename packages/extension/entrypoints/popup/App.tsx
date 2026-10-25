import { useEffect, useRef, useState } from 'react';
import { useWalletStore } from './store';
import { Setup } from './pages/Setup';
import { Unlock } from './pages/Unlock';
import { Dashboard } from './pages/Dashboard';
import { AddCredential } from './pages/AddCredential';
import { Connect } from './pages/Connect';
import { ConnectedApps } from './pages/ConnectedApps';
import { ApprovalRequest } from './pages/ApprovalRequest';
import { RequestHistory } from './pages/RequestHistory';
import { Settings } from './pages/Settings';
import { FloatingActionMenu } from './components/FloatingActionMenu';
import { Raven } from './components/Raven';

export default function App() {
  const { currentPage, modal, sessions, credentials, pendingApprovals, loading, init, closeModal } = useWalletStore();
  const justUnlocked = useJustUnlocked(currentPage, loading);

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
        // Also sent on auto-lock: show the unlock screen rather than a
        // wallet that looks open but can't add keys or approve apps.
        useWalletStore.getState().syncLockState().then((unlocked) => {
          if (unlocked) useWalletStore.getState().refreshData();
        });
      } else if (msg.action === 'usageUpdated') {
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
        <div className="scanlines" aria-hidden="true" />
      </div>
    );
  }

  const showNav =
    currentPage !== 'setup' &&
    currentPage !== 'unlock' &&
    currentPage !== 'approval';

  const showFab = showNav && !modal;
  const locked = currentPage === 'setup' || currentPage === 'unlock';

  return (
    <div className={`app ${locked ? 'app-locked' : ''}`}>
      <header className={`header ${showNav ? 'header-bordered' : ''}`}>
        <h1 className="logo">
          <span className="logo-tile" aria-hidden="true">b</span>
          Byoky
        </h1>
        {locked && (
          <span className="status-pill">
            <span className="status-dot" />
            {currentPage === 'setup' ? 'Setup' : 'Locked'}
          </span>
        )}
        {currentPage === 'approval' && pendingApprovals.length > 0 && (
          <span className="pending-pill">{pendingApprovals.length} pending</span>
        )}
        {showNav && (
          <nav className="nav" aria-label="Wallet sections">
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
              className={currentPage === 'connect' || currentPage === 'connected-apps' || currentPage === 'request-history' ? 'active' : ''}
              onClick={() => useWalletStore.getState().navigate('connect')}
              title="Connect"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              {sessions.length > 0 && (
                <span className="nav-badge">{sessions.length}</span>
              )}
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
      {showNav && (
        <div className="status-strip">
          <span className="status-strip-state">
            <span className="status-dot" />
            Unlocked · {credentials.length} {credentials.length === 1 ? 'key' : 'keys'}
          </span>
          <Raven
            view="head"
            size={42}
            state={justUnlocked ? 'nod-then-watching' : 'watching'}
            label="Muninn is awake"
          />
        </div>
      )}
      <main className={`content ${showFab ? 'has-fab' : ''}`}>
        <div key={currentPage} className="page-enter">
          {currentPage === 'setup' && <Setup />}
          {currentPage === 'unlock' && <Unlock />}
          {currentPage === 'dashboard' && <Dashboard />}
          {currentPage === 'connect' && <Connect />}
          {currentPage === 'connected-apps' && <ConnectedApps />}
          {currentPage === 'approval' && <ApprovalRequest />}
          {currentPage === 'request-history' && <RequestHistory />}
          {currentPage === 'settings' && <Settings />}
        </div>
      </main>
      {showFab && <FloatingActionMenu />}
      {modal === 'add-credential' && (
        <Modal title="Add credential" onClose={closeModal}>
          <AddCredential />
        </Modal>
      )}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

/**
 * True once the wallet goes from the setup or unlock page to an unlocked
 * page, so the raven in the status strip can nod. Pages shown while the
 * popup is still loading don't count: they aren't a real locked state.
 */
function useJustUnlocked(currentPage: string, loading: boolean): boolean {
  const wasLocked = useRef(false);
  const [justUnlocked, setJustUnlocked] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (currentPage === 'setup' || currentPage === 'unlock') {
      wasLocked.current = true;
      setJustUnlocked(false);
    } else if (wasLocked.current) {
      wasLocked.current = false;
      setJustUnlocked(true);
    }
  }, [currentPage, loading]);

  return justUnlocked;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-sheet" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
