import { useWalletStore } from '../store';

/**
 * The + button. It adds a credential, the one thing there is to add, so it
 * opens the add credential sheet itself: as a one-item menu, its item sat
 * before it in the page and Tab left the popup instead of reaching it.
 */
export function FloatingActionMenu() {
  const { openModal } = useWalletStore();

  return (
    <div className="fab-root">
      <button
        type="button"
        className="fab-button"
        onClick={() => openModal('add-credential')}
        aria-label="Add credential"
        title="Add credential"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
