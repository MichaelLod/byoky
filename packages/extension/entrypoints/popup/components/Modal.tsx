import { useRef, type ReactNode } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';

/** Bottom sheet over the popup (add credential, a key's usage). */
export function Modal({ title, onClose, initialFocus, children }: {
  title: string;
  onClose: () => void;
  /** Selector of the control to focus when the sheet opens. */
  initialFocus?: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(sheetRef, { onEscape: onClose, initialFocus });

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={sheetRef}
        className="modal-sheet"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
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
