import { useEffect, useRef, useState } from 'react';
import { useWalletStore } from '../store';

export function FloatingActionMenu() {
  const { openModal } = useWalletStore();
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

  function pickModal(target: 'add-credential') {
    setOpen(false);
    openModal(target);
  }

  return (
    <div className={`fab-root ${open ? 'open' : ''}`} ref={rootRef}>
      {open && (
        <div className="fab-menu" role="menu">
          <button className="fab-menu-item" role="menuitem" onClick={() => pickModal('add-credential')}>
            <span className="fab-menu-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M2 10h20" />
              </svg>
            </span>
            <span>Add credential</span>
          </button>
        </div>
      )}
      <button
        className="fab-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open add menu'}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
