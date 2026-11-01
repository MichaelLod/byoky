import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { Modal } from './components/Modal';

export default function App() {
  const {
    currentPage, modal, sessions, credentials, pendingApprovals, loading, isUnlocked, approvedAt, init, closeModal,
  } = useWalletStore();
  const justUnlocked = useJustUnlocked(currentPage, loading);
  useActivityPing(isUnlocked);

  useEffect(() => {
    init();
  }, [init]);

  // Listen for new pending approvals from background
  useEffect(() => {
    function listener(message: unknown) {
      const msg = message as Record<string, string> | null;
      if (!msg || msg.type !== 'BYOKY_INTERNAL') return;
      if (msg.action === 'newPendingApproval') {
        // While locked, the unlock screen lists what is waiting instead.
        if (!useWalletStore.getState().isUnlocked) {
          useWalletStore.getState().refreshPending();
          return;
        }
        useWalletStore.getState().refreshData().then(() => {
          if (useWalletStore.getState().pendingApprovals.length > 0) {
            useWalletStore.getState().navigate('approval');
          }
        });
      } else if (msg.action === 'sessionChanged') {
        // Also sent when another view finishes setup: leave the setup
        // screen, whose password would no longer be the wallet's.
        if (!useWalletStore.getState().isInitialized) {
          useWalletStore.getState().init();
          return;
        }
        // Also sent on auto-lock: show the unlock screen rather than a
        // wallet that looks open but can't add keys or approve apps.
        useWalletStore.getState().syncLockState().then((unlocked) => {
          if (unlocked) useWalletStore.getState().refreshData();
          else useWalletStore.getState().refreshPending();
        });
      } else if (msg.action === 'usageUpdated') {
        useWalletStore.getState().refreshData();
      } else if (msg.action === 'approvalsChanged') {
        // A request was answered, timed out or auto-approved somewhere else.
        if (useWalletStore.getState().isUnlocked) useWalletStore.getState().refreshData();
        else useWalletStore.getState().refreshPending();
      }
    }
    try {
      browser.runtime.onMessage.addListener(listener);
      return () => browser.runtime.onMessage.removeListener(listener);
    } catch {
      // Side panel may not support onMessage in all contexts
    }
  }, []);

  // Only the first check of the wallet's state blanks the popup. Forms that
  // wait on the background keep their page (and what was typed) on screen.
  if (loading) {
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
          <img className="logo-tile" src="/logo.svg" alt="" />
          Byoky
        </h1>
        {locked && (
          <span className="status-pill">
            <span className="status-dot" />
            {currentPage === 'setup' ? 'Setup' : 'Locked'}
          </span>
        )}
        {(currentPage === 'approval' || currentPage === 'unlock') && pendingApprovals.length > 0 && (
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
          {/* Nods once after an unlock and after each approval: a new
              approval remounts it. */}
          <Raven
            key={approvedAt ?? 'unlocked'}
            view="head"
            size={42}
            state={justUnlocked || approvedAt ? 'nod-then-watching' : 'watching'}
            label="Muninn is awake"
          />
        </div>
      )}
      <main className={`content ${showFab ? 'has-fab' : ''}`}>
        <div key={currentPage} className="page-enter">
          {/* Starts over with each page and each request at the head of the queue. */}
          <PageErrorBoundary key={currentPage === 'approval' ? pendingApprovals[0]?.id : undefined}>
            {currentPage === 'setup' && <Setup />}
            {currentPage === 'unlock' && <Unlock />}
            {currentPage === 'dashboard' && <Dashboard />}
            {currentPage === 'connect' && <Connect />}
            {currentPage === 'connected-apps' && <ConnectedApps />}
            {currentPage === 'approval' && <ApprovalRequest />}
            {currentPage === 'request-history' && <RequestHistory />}
            {currentPage === 'settings' && <Settings />}
          </PageErrorBoundary>
        </div>
      </main>
      {showFab && <FloatingActionMenu />}
      {modal === 'add-credential' && (
        <Modal title="Add credential" onClose={closeModal} initialFocus="#provider">
          <AddCredential />
        </Modal>
      )}
      <div className="scanlines" aria-hidden="true" />
    </div>
  );
}

/**
 * A page that throws while rendering would otherwise unmount the whole popup
 * and leave a blank panel. This keeps the header and offers the ways out:
 * rejecting the request at the head of the queue (a page can send a request
 * the approval screen can't show) and locking the wallet.
 */
class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <PageFailed /> : this.props.children;
  }
}

function PageFailed() {
  const { pendingApprovals, isUnlocked, rejectConnect, lock } = useWalletStore();
  const head = pendingApprovals[0];
  return (
    <div className="empty-state" role="alert">
      <p>Something went wrong showing this page.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
        {head && (
          <button className="btn btn-secondary" onClick={() => rejectConnect(head.id)}>
            Reject the connection request
          </button>
        )}
        {isUnlocked && (
          <button className="btn btn-secondary" onClick={() => lock()}>
            Lock wallet
          </button>
        )}
      </div>
    </div>
  );
}

// Well under the background's 20-minute idle lock, and few enough messages.
const ACTIVITY_PING_MS = 30_000;

/**
 * Tell the background the user is working in the wallet, so the idle
 * auto-lock doesn't fire mid-task (say, while typing a new key). Only clicks,
 * taps and keys count; refreshes the background triggers don't.
 */
function useActivityPing(unlocked: boolean) {
  useEffect(() => {
    if (!unlocked) return;
    let lastSent = 0;
    function onActivity() {
      const now = Date.now();
      if (now - lastSent < ACTIVITY_PING_MS) return;
      lastSent = now;
      Promise.resolve(
        browser.runtime.sendMessage({ type: 'BYOKY_INTERNAL', action: 'userActivity' }),
      ).catch(() => {});
    }
    // Capture phase, so controls that stop propagation still count.
    document.addEventListener('pointerdown', onActivity, true);
    document.addEventListener('keydown', onActivity, true);
    return () => {
      document.removeEventListener('pointerdown', onActivity, true);
      document.removeEventListener('keydown', onActivity, true);
    };
  }, [unlocked]);
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
