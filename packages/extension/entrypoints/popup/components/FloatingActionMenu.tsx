import { useEffect, useRef, useState } from 'react';
import { useWalletStore } from '../store';

export function FloatingActionMenu() {
  const { navigate } = useWalletStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function go(page: 'add-credential' | 'redeem-gift' | 'app-store') {
    setOpen(false);
    navigate(page);
  }

  return (
    <div className={`fab-root ${open ? 'open' : ''}`} ref={rootRef}>
      {open && (
        <div className="fab-menu" role="menu">
          <button className="fab-menu-item" role="menuitem" onClick={() => go('add-credential')}>
            <span className="fab-menu-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </span>
            <span>Add credential</span>
          </button>
          <button className="fab-menu-item" role="menuitem" onClick={() => go('redeem-gift')}>
            <span className="fab-menu-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12v10H4V12" />
                <path d="M2 7h20v5H2z" />
                <path d="M12 22V7" />
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
              </svg>
            </span>
            <span>Redeem gift</span>
          </button>
          <button className="fab-menu-item" role="menuitem" onClick={() => go('app-store')}>
            <span className="fab-menu-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="9" height="9" rx="2" />
                <rect x="13" y="2" width="9" height="9" rx="2" />
                <rect x="2" y="13" width="9" height="9" rx="2" />
                <rect x="13" y="13" width="9" height="9" rx="2" />
              </svg>
            </span>
            <span>Add app</span>
          </button>
        </div>
      )}
      <button
        className="fab-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open add menu'}
        aria-expanded={open}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
